import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { DatabaseService } from '../database/database.service';
import { agentSessions, agents, users } from '../database/schema';

export interface AgentAuthContext {
  agentId: string;
  ownerId: string;
}

export interface AgentTokens {
  accessToken: string;
  refreshToken: string;
  agent: {
    id: string;
    ownerId: string;
    nodeId: string;
    displayName: string;
    ownerEmail: string | null;
  };
}

@Injectable()
export class AgentAuthService {
  private readonly logger = new Logger(AgentAuthService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly REFRESH_DAYS = 30;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private normalizeStatus(input: unknown): string {
    return String(input ?? '').trim().toLowerCase();
  }

  async issueSessionForAgent(agentId: string): Promise<AgentTokens> {
    const [agent] = await this.db.db
      .select({
        id: agents.id,
        ownerId: agents.ownerId,
        nodeId: agents.nodeId,
        displayName: agents.displayName,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      throw new UnauthorizedException('Agent not found');
    }
    if (this.normalizeStatus(agent.status) !== 'active') {
      throw new ForbiddenException('Agent is revoked');
    }

    return this.createSession({
      id: agent.id,
      ownerId: agent.ownerId,
      nodeId: agent.nodeId,
      displayName: agent.displayName,
    });
  }

  async refresh(refreshToken: string): Promise<AgentTokens> {
    let payload: { jti: string; sub: string; typ?: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.typ !== 'agent') {
      throw new UnauthorizedException('Invalid token type');
    }

    const [session] = await this.db.db
      .select()
      .from(agentSessions)
      .where(
        and(eq(agentSessions.id, payload.jti), isNull(agentSessions.revokedAt)),
      )
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('Session not found or revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const valid = await bcrypt.compare(
      refreshToken,
      session.hashedRefreshToken,
    );
    if (!valid) {
      await this.db.db
        .update(agentSessions)
        .set({ revokedAt: new Date() })
        .where(eq(agentSessions.id, session.id));
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    await this.db.db
      .update(agentSessions)
      .set({ revokedAt: new Date() })
      .where(eq(agentSessions.id, session.id));

    return this.issueSessionForAgent(session.agentId);
  }

  async revokeAllSessionsForAgent(agentId: string): Promise<void> {
    await this.db.db
      .update(agentSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentSessions.agentId, agentId),
          isNull(agentSessions.revokedAt),
        ),
      );
  }

  async isAgentActive(agentId: string): Promise<boolean> {
    const [agent] = await this.db.db
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return this.normalizeStatus(agent?.status) === 'active';
  }

  async touchLastSeen(agentId: string): Promise<void> {
    await this.db.db
      .update(agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(agents.id, agentId));
  }

  verifyAccessToken(token: string): AgentAuthContext {
    let payload: { sub?: string; ownerId?: string; typ?: string };
    try {
      payload = this.jwt.verify(token, { secret: this.getAccessSecret() });
    } catch {
      throw new UnauthorizedException('Invalid agent token');
    }

    if (!payload.sub || !payload.ownerId || payload.typ !== 'agent') {
      throw new UnauthorizedException('Malformed agent token');
    }

    return { agentId: payload.sub, ownerId: payload.ownerId };
  }

  private async createSession(agent: {
    id: string;
    ownerId: string;
    nodeId: string;
    displayName: string;
  }): Promise<AgentTokens> {
    const [ownerUser] = await this.db.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, agent.ownerId))
      .limit(1);
    const ownerEmail = ownerUser?.email ?? null;

    const sessionId = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_DAYS);

    const accessTtl = this.config.get<string>('AGENT_JWT_ACCESS_TTL') || '15m';
    const refreshTtl =
      this.config.get<string>('AGENT_JWT_REFRESH_TTL') ||
      `${this.REFRESH_DAYS}d`;

    const accessToken = this.jwt.sign(
      {
        sub: agent.id,
        ownerId: agent.ownerId,
        nodeId: agent.nodeId,
        displayName: agent.displayName,
        typ: 'agent',
      },
      {
        secret: this.getAccessSecret(),
        expiresIn: accessTtl as any,
      },
    );

    const refreshToken = this.jwt.sign(
      {
        sub: agent.id,
        jti: sessionId,
        ownerId: agent.ownerId,
        typ: 'agent',
      },
      {
        secret: this.getRefreshSecret(),
        expiresIn: refreshTtl as any,
      },
    );

    const hashedRefreshToken = await bcrypt.hash(
      refreshToken,
      this.SALT_ROUNDS,
    );
    await this.db.db.insert(agentSessions).values({
      id: sessionId,
      agentId: agent.id,
      hashedRefreshToken,
      expiresAt,
    });

    this.logger.log(`Issued agent session for ${agent.id}`);

    return {
      accessToken,
      refreshToken,
      agent: {
        id: agent.id,
        ownerId: agent.ownerId,
        nodeId: agent.nodeId,
        displayName: agent.displayName,
        ownerEmail,
      },
    };
  }

  private getAccessSecret(): string {
    return this.requireAgentJwtEnv('AGENT_JWT_ACCESS_SECRET');
  }

  private getRefreshSecret(): string {
    return this.requireAgentJwtEnv('AGENT_JWT_REFRESH_SECRET');
  }

  private requireAgentJwtEnv(key: string): string {
    const raw = this.config.get<string>(key);
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      this.logger.error(`Missing ${key}.`);
      throw new InternalServerErrorException(
        `Server misconfiguration: ${key} is not set. `,
      );
    }
    return value;
  }
}
