import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

import { DatabaseService } from '../database/database.service';
import { AgentAuthService } from '../agent-auth/agent-auth.service';
import { AgentGateway } from '../ws/agent.gateway';
import {
  agentPairings,
  agentPairingAudit,
  agents,
  agentSessions,
} from '../database/schema';
import {
  StartPairingResponseDto,
  StartPairingRequestDto,
  PairingStatusDto,
  ConsumePairingDto,
} from './dto/index';

type AuditActorType = 'system' | 'owner' | 'agent';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);
  private readonly PAIRING_EXPIRY_MINUTES = 15;
  private readonly requestLog = new Map<string, number[]>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly agentAuth: AgentAuthService,
    private readonly agentGateway: AgentGateway,
  ) {}

  /**
   * Generate a random pairing code (6 uppercase alphanumeric)
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  private async writeAudit(input: {
    pairingId: string;
    action: string;
    actorType: AuditActorType;
    actorUserId?: string | null;
    meta?: RequestMeta;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.db.insert(agentPairingAudit).values({
      pairingId: input.pairingId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      ipAddress: input.meta?.ip,
      userAgent: input.meta?.userAgent,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  }

  private enforceRateLimit(
    action: 'start' | 'status' | 'consume',
    meta?: RequestMeta,
  ): void {
    const ip = (meta?.ip || 'unknown').slice(0, 80);
    const now = Date.now();
    const windowMs = 60_000;
    const limits: Record<typeof action, number> = {
      start: 30,
      status: 120,
      consume: 30,
    };
    const key = `${action}:${ip}`;
    const prev = this.requestLog.get(key) || [];
    const next = prev.filter((ts) => now - ts < windowMs);
    if (next.length >= limits[action]) {
      throw new BadRequestException('Too many requests, please retry shortly');
    }
    next.push(now);
    this.requestLog.set(key, next);
  }

  private asDbStatus(input: unknown): string {
    return String(input ?? '').trim();
  }

  private toActiveStatus(currentStatus: unknown): 'active' | 'ACTIVE' {
    const status = this.asDbStatus(currentStatus);
    return status === status.toUpperCase() ? 'ACTIVE' : 'active';
  }

  private toRevokedStatus(currentStatus: unknown): 'revoked' | 'REVOKED' {
    const status = this.asDbStatus(currentStatus);
    return status === status.toUpperCase() ? 'REVOKED' : 'revoked';
  }

  /**
   * POST /agent/pair/start
   * Unauthenticated - creates pending pairing without owner
   */
  async startPairing(
    input: StartPairingRequestDto,
    meta?: RequestMeta,
  ): Promise<StartPairingResponseDto> {
    this.enforceRateLimit('start', meta);
    let code = this.generateCode();
    const baseUrl =
      this.config.get<string>('AGENT_LOGIN_BASE_URL') ||
      'http://localhost:3000/agent/auth';
    const expiryMinutes =
      this.config.get<number>('AGENT_PAIRING_EXPIRY_MINUTES') ||
      this.PAIRING_EXPIRY_MINUTES;

    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Retry on unique constraint violation (code collision)
    let retries = 0;
    while (retries < 5) {
      try {
        const [inserted] = await this.db.db
          .insert(agentPairings)
          .values({
            code,
            status: 'pending',
            ownerId: null,
            sessionId: null,
            agentId: null,
            nodeId: input.nodeId?.trim() || null,
            appVersion: input.appVersion?.trim() || null,
            agentName: input.agentName?.trim() || null,
            expiresAt,
          })
          .returning({ id: agentPairings.id });

        await this.writeAudit({
          pairingId: inserted.id,
          action: 'created',
          actorType: 'system',
          actorUserId: null,
          meta,
          metadata: {
            nodeId: input.nodeId,
            agentName: input.agentName,
            appVersion: input.appVersion,
          },
        });

        break;
      } catch (error: any) {
        if (error.code === '23505' && retries < 4) {
          code = this.generateCode();
          retries++;
        } else {
          this.logger.error(`Failed to start pairing: ${error}`);
          throw new BadRequestException('Failed to start pairing');
        }
      }
    }

    return {
      pairing_code: code,
      login_url: `${baseUrl}?code=${code}`,
      expires_at: expiresAt,
    };
  }

  /**
   * GET /agent/pair/:code/status
   * Check pairing status - no auth required
   */
  async getPairingStatus(
    code: string,
    meta?: RequestMeta,
  ): Promise<PairingStatusDto> {
    this.enforceRateLimit('status', meta);
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    if (
      new Date() > record.expiresAt &&
      record.status !== 'consumed' &&
      record.status !== 'expired'
    ) {
      const previousStatus = record.status;
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      record.status = 'expired';

      await this.writeAudit({
        pairingId: record.id,
        action: 'expired',
        actorType: 'system',
        actorUserId: null,
        meta,
        metadata: { previousStatus },
      });
    }

    await this.writeAudit({
      pairingId: record.id,
      action: 'status_checked',
      actorType: 'agent',
      actorUserId: null,
      meta,
      metadata: { status: record.status },
    });

    return {
      status: record.status,
      expires_at: record.expiresAt,
      approved_at: record.approvedAt || undefined,
      consumed_at: record.consumedAt || undefined,
    };
  }

  /**
   * POST /agent/pair/:code/approve
   * OWNER-only - sets owner_id on the pairing
   */
  async approvePairing(
    code: string,
    ownerId: string,
    meta?: RequestMeta,
  ): Promise<{ message: string }> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    if (new Date() > record.expiresAt) {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));

      await this.writeAudit({
        pairingId: record.id,
        action: 'expired',
        actorType: 'system',
        actorUserId: null,
        meta,
        metadata: { previousStatus: record.status },
      });

      throw new BadRequestException('Pairing code has expired');
    }

    if (record.status !== 'pending') {
      throw new BadRequestException(
        `Cannot approve pairing with status: ${record.status}`,
      );
    }

    try {
      await this.db.db
        .update(agentPairings)
        .set({
          status: 'approved',
          ownerId,
          approvedAt: new Date(),
        })
        .where(eq(agentPairings.code, code));

      await this.writeAudit({
        pairingId: record.id,
        action: 'approved',
        actorType: 'owner',
        actorUserId: ownerId,
        meta,
      });

      return { message: 'Pairing approved successfully' };
    } catch (error) {
      this.logger.error(`Failed to approve pairing: ${error}`);
      throw new BadRequestException('Failed to approve pairing');
    }
  }

  /**
   * POST /agent/pair/:code/consume
   * Exchange approved code for standard auth tokens (accessToken, refreshToken, user)
   * Idempotent: already-consumed returns { status: 'already_consumed' }
   */
  async consumePairing(
    code: string,
    meta?: RequestMeta,
  ): Promise<ConsumePairingDto> {
    this.enforceRateLimit('consume', meta);
    const result = await this.db.db.transaction(async (tx: any) => {
      const pairing = await tx
        .select()
        .from(agentPairings)
        .where(eq(agentPairings.code, code))
        .limit(1);

      if (pairing.length === 0) {
        throw new NotFoundException('Pairing code not found');
      }

      const record = pairing[0];
      if (record.status === 'consumed') {
        return { type: 'already_consumed' as const, record };
      }
      if (new Date() > record.expiresAt) {
        await tx
          .update(agentPairings)
          .set({ status: 'expired' })
          .where(eq(agentPairings.code, code));
        throw new BadRequestException('Pairing code has expired');
      }
      if (record.status !== 'approved' || !record.ownerId) {
        throw new BadRequestException(
          `Pairing must be approved before consuming. Current status: ${record.status}`,
        );
      }

      const nodeId = (record.nodeId || '').trim();
      if (!nodeId) {
        throw new BadRequestException('Pairing missing node identity');
      }

      const existingAgent = await tx
        .select()
        .from(agents)
        .where(
          and(eq(agents.ownerId, record.ownerId), eq(agents.nodeId, nodeId)),
        )
        .limit(1);

      let agentId = existingAgent[0]?.id;
      if (!agentId) {
        const inserted = await tx
          .insert(agents)
          .values({
            ownerId: record.ownerId,
            nodeId,
            displayName: record.agentName || nodeId,
          })
          .returning({ id: agents.id });
        agentId = inserted[0].id;
      } else {
        const activeStatus = this.toActiveStatus(existingAgent[0].status);
        await tx
          .update(agents)
          .set({
            displayName: record.agentName || nodeId,
            status: activeStatus,
            revokedAt: null,
          })
          .where(eq(agents.id, agentId));
      }

      const updated = await tx
        .update(agentPairings)
        .set({
          status: 'consumed',
          consumedAt: new Date(),
          agentId,
        })
        .where(
          and(
            eq(agentPairings.code, code),
            eq(agentPairings.status, 'approved'),
            gt(agentPairings.expiresAt, new Date()),
            isNull(agentPairings.consumedAt),
          ),
        )
        .returning({ id: agentPairings.id });

      if (updated.length === 0) {
        return { type: 'already_consumed' as const, record };
      }

      return { type: 'consumed' as const, record, agentId };
    });

    if (result.type === 'already_consumed') {
      await this.writeAudit({
        pairingId: result.record.id,
        action: 'already_consumed',
        actorType: 'agent',
        actorUserId: null,
        meta,
      });
      return { status: 'already_consumed' };
    }

    const tokens = await this.agentAuth.issueSessionForAgent(result.agentId);

    await this.writeAudit({
      pairingId: result.record.id,
      action: 'consumed',
      actorType: 'agent',
      actorUserId: null,
      meta,
      metadata: { agentId: result.agentId },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      agent: tokens.agent,
    };
  }

  async listOwnerAgents(ownerId: string) {
    const rows = await this.db.db
      .select({
        id: agents.id,
        nodeId: agents.nodeId,
        displayName: agents.displayName,
        status: agents.status,
        lastSeenAt: agents.lastSeenAt,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.ownerId, ownerId));

    return rows.map((agent) => {
      const runtime = this.agentGateway.getAgentRuntimeState(agent.id);
      const normalizedStatus = String(agent.status).toLowerCase();
      const status = normalizedStatus === 'revoked' ? 'revoked' : 'active';
      const runtimeStatus =
        status === 'revoked'
          ? 'revoked'
          : runtime.connected
            ? 'online'
            : 'offline';
      const activityState =
        runtimeStatus === 'online' ? runtime.activityState : 'offline';

      return {
        ...agent,
        status,
        runtimeStatus,
        activityState,
        lastHeartbeatAt: runtime.lastHeartbeatAt,
      };
    });
  }

  async revokeOwnerAgent(ownerId: string, agentId: string): Promise<void> {
    const target = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);

    if (!target[0]) {
      throw new NotFoundException('Agent not found');
    }

    await this.db.db
      .update(agents)
      .set({
        status: sql`${this.toRevokedStatus(target[0].status)}::agent_status`,
        revokedAt: new Date(),
      })
      .where(eq(agents.id, agentId));

    await this.db.db
      .update(agentSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentSessions.agentId, agentId),
          isNull(agentSessions.revokedAt),
        ),
      );

    this.agentGateway.kickAgent(agentId);
  }
}
