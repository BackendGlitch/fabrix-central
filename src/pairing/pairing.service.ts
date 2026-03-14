import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';

import { DatabaseService } from '../database/database.service';
import { AuthService } from '../auth/auth.service';
import { agentPairings, agentPairingAudit, userSessions } from '../database/schema';
import {
  StartPairingResponseDto,
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

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
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

  private getRefreshSecret(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
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

  /**
   * POST /agent/pair/start
   * Unauthenticated - creates pending pairing without owner
   */
  async startPairing(
    agentName?: string,
    meta?: RequestMeta,
  ): Promise<StartPairingResponseDto> {
    let code = this.generateCode();
    const baseUrl =
      this.config.get<string>('AGENT_LOGIN_BASE_URL') || 'http://localhost:3000/agent/auth';
    const expiryMinutes =
      this.config.get<number>('AGENT_PAIRING_EXPIRY_MINUTES') || this.PAIRING_EXPIRY_MINUTES;

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
            agentName,
            expiresAt,
          })
          .returning({ id: agentPairings.id });

        await this.writeAudit({
          pairingId: inserted.id,
          action: 'created',
          actorType: 'system',
          actorUserId: null,
          meta,
          metadata: { agentName },
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
  async getPairingStatus(code: string, meta?: RequestMeta): Promise<PairingStatusDto> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    if (new Date() > record.expiresAt && record.status !== 'consumed' && record.status !== 'expired') {
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
  async consumePairing(code: string, meta?: RequestMeta): Promise<ConsumePairingDto> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    if (record.status === 'consumed') {
      await this.writeAudit({
        pairingId: record.id,
        action: 'already_consumed',
        actorType: 'agent',
        actorUserId: null,
        meta,
      });
      return { status: 'already_consumed' };
    }

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

    if (record.status !== 'approved') {
      throw new BadRequestException(
        `Pairing must be approved before consuming. Current status: ${record.status}`,
      );
    }

    if (!record.ownerId) {
      throw new BadRequestException('Pairing has not been approved by an owner');
    }

    const tokens = await this.auth.issueSessionForUserId(record.ownerId);

    let sessionId: string | undefined;
    try {
      const payload = this.jwt.verify(tokens.refreshToken, {
        secret: this.getRefreshSecret(),
      }) as { jti?: string };
      sessionId = payload.jti;
    } catch (error) {
      this.logger.error(`Failed to verify refresh token: ${error}`);
      throw new BadRequestException('Failed to issue session');
    }

    if (!sessionId) {
      throw new BadRequestException('Failed to issue session');
    }

    const updated = await this.db.db
      .update(agentPairings)
      .set({
        status: 'consumed',
        consumedAt: new Date(),
        sessionId,
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
      await this.db.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, sessionId));

      await this.writeAudit({
        pairingId: record.id,
        action: 'already_consumed',
        actorType: 'agent',
        actorUserId: null,
        meta,
      });

      return { status: 'already_consumed' };
    }

    await this.writeAudit({
      pairingId: record.id,
      action: 'consumed',
      actorType: 'agent',
      actorUserId: null,
      meta,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    };
  }
}
