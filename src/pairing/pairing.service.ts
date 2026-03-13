import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

import { DatabaseService } from '../database/database.service';
import { agentPairings, agentPairingAudit, userSessions } from '../database/schema';
import {
  StartPairingResponseDto,
  PairingStatusDto,
  ConsumePairingDto,
} from './dto/index';

@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);
  private readonly PAIRING_EXPIRY_MINUTES = 15;
  private readonly REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  private readonly SALT_ROUNDS = 12;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

  /**
   * POST /agent/pair/start
   * Unauthenticated - creates pending pairing without owner
   */
  async startPairing(agentName?: string): Promise<StartPairingResponseDto> {
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
        await this.db.db.insert(agentPairings).values({
          code,
          status: 'pending',
          ownerId: null, // No owner yet - will be set on approve
          sessionId: null,
          agentName,
          expiresAt,
        });

        // Audit: system created the pairing
        await this.db.db.insert(agentPairingAudit).values({
          pairingId: (
            await this.db.db
              .select({ id: agentPairings.id })
              .from(agentPairings)
              .where(eq(agentPairings.code, code))
          )[0].id,
          action: 'created',
          actorUserId: null,
          actorType: 'system',
          metadata: JSON.stringify({ agentName }),
        });

        break;
      } catch (error: any) {
        if (error.code === '23505' && retries < 4) {
          // Unique constraint violation - retry with new code
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
  async getPairingStatus(code: string): Promise<PairingStatusDto> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    // Check if expired and update if needed
    if (new Date() > record.expiresAt && record.status === 'pending') {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      record.status = 'expired';
    }

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
  async approvePairing(code: string, ownerId: string): Promise<{ message: string }> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    // Check if already expired
    if (new Date() > record.expiresAt) {
      throw new BadRequestException('Pairing code has expired');
    }

    // Check status
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
          ownerId, // Set owner here
          approvedAt: new Date(),
        })
        .where(eq(agentPairings.code, code));

      // Audit: owner approved the pairing
      await this.db.db.insert(agentPairingAudit).values({
        pairingId: record.id,
        action: 'approved',
        actorUserId: ownerId,
        actorType: 'owner',
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
   * Must be atomic and idempotent
   */
  async consumePairing(code: string): Promise<ConsumePairingDto> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    // Idempotent: if already consumed, return special response
    if (record.status === 'consumed') {
      throw new ConflictException('Pairing code already consumed');
    }

    // Check if expired
    if (new Date() > record.expiresAt) {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      throw new BadRequestException('Pairing code has expired');
    }

    // Check if approved
    if (record.status !== 'approved') {
      throw new BadRequestException(
        `Pairing must be approved before consuming. Current status: ${record.status}`,
      );
    }

    // Must have owner
    if (!record.ownerId) {
      throw new BadRequestException('Pairing has not been approved by an owner');
    }

    // Fetch owner user
    const ownerUser = await this.db.db
      .select()
      .from(agentPairings)
      .innerJoin(agentPairings, eq(agentPairings.ownerId, record.ownerId))
      .limit(1);

    // Get actual owner details from users table
    const { users } = await import('../database/schema.js');
    const ownerDetails = await this.db.db
      .select()
      .from(users)
      .where(eq(users.id, record.ownerId))
      .limit(1);

    if (ownerDetails.length === 0) {
      throw new BadRequestException('Owner user not found');
    }

    const owner = ownerDetails[0];

    // Create new session for the owner
    const refreshTokenExpiredAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL_MS);
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET') || 'default_secret';

    // Hash refresh token
    const refreshTokenPlain = `${code}_${Date.now()}`;
    const hashedRefreshToken = await bcrypt.hash(refreshTokenPlain, this.SALT_ROUNDS);

    // Create session
    const [newSession] = await this.db.db
      .insert(userSessions)
      .values({
        userId: record.ownerId,
        hashedRefreshToken,
        expiredAt: refreshTokenExpiredAt,
      })
      .returning({ id: userSessions.id });

    // Generate JWT tokens
    const accessTokenPayload = {
      sub: record.ownerId,
      email: owner.email,
      name: owner.name,
      role: owner.role,
    };

    const accessToken = this.jwt.sign(accessTokenPayload, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(
      { sessionId: newSession.id },
      { expiresIn: '30d', secret: refreshSecret },
    );

    // Atomic update: consume the pairing AND set the session_id
    // Using WHERE clause to ensure this only succeeds if still approved
    try {
      const updated = await this.db.db
        .update(agentPairings)
        .set({
          status: 'consumed',
          consumedAt: new Date(),
          sessionId: newSession.id,
        })
        .where(
          and(
            eq(agentPairings.code, code),
            eq(agentPairings.status, 'approved'),
            gt(agentPairings.expiresAt, new Date()),
            isNull(agentPairings.consumedAt),
          ),
        );

      if (!updated) {
        throw new ConflictException('Pairing code was already consumed or is no longer valid');
      }

      // Audit: agent consumed the pairing
      await this.db.db.insert(agentPairingAudit).values({
        pairingId: record.id,
        action: 'consumed',
        actorUserId: null,
        actorType: 'agent',
      });

      return {
        accessToken,
        refreshToken,
        user: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: owner.role,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to consume pairing: ${error}`);
      throw new BadRequestException('Failed to consume pairing');
    }
  }
}