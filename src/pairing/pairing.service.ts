import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

import { DatabaseService } from '../database/database.service';
import { agentPairings } from '../database/schema';
import {
  StartPairingResponseDto,
  PairingStatusDto,
  ConsumePairingDto,
} from './dto/index';

@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);
  private readonly PAIRING_EXPIRY_MINUTES = 15;
  private readonly AGENT_TOKEN_EXPIRY_DAYS = 365;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate a random pairing code (6-8 uppercase alphanumeric)
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
   * Start pairing: generate code and return login URL
   */
  async startPairing(userId: string, agentName?: string): Promise<StartPairingResponseDto> {
    const code = this.generateCode();
    const baseUrl =
      this.config.get<string>('AGENT_LOGIN_BASE_URL') || 'http://localhost:3000/agent/auth';
    const expiryMinutes = this.config.get<number>('AGENT_PAIRING_EXPIRY_MINUTES') || this.PAIRING_EXPIRY_MINUTES;
    
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    try {
      await this.db.db.insert(agentPairings).values({
        code,
        userId,
        agentName,
        status: 'pending',
        expiresAt,
      });

      return {
        code,
        loginUrl: `${baseUrl}?code=${code}`,
        expiresAt,
      };
    } catch (error) {
      this.logger.error(`Failed to start pairing: ${error}`);
      throw new BadRequestException('Failed to start pairing');
    }
  }

  /**
   * Get pairing status by code
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

    // Check if expired
    if (new Date() > record.expiresAt && record.status !== 'consumed') {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      record.status = 'expired';
    }

    return {
      code: record.code,
      status: record.status,
      expiresAt: record.expiresAt,
      approvedAt: record.approvedAt || undefined,
      consumedAt: record.consumedAt || undefined,
    };
  }

  /**
   * Approve pairing (OWNER only)
   */
  async approvePairing(code: string, userId: string): Promise<void> {
    const pairing = await this.db.db
      .select()
      .from(agentPairings)
      .where(eq(agentPairings.code, code))
      .limit(1);

    if (pairing.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const record = pairing[0];

    // Check if owner
    if (record.userId !== userId) {
      throw new ForbiddenException('Only the owner can approve this pairing');
    }

    // Check status
    if (record.status !== 'pending') {
      throw new BadRequestException(
        `Cannot approve pairing with status: ${record.status}`,
      );
    }

    // Check expiration
    if (new Date() > record.expiresAt) {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      throw new BadRequestException('Pairing code has expired');
    }

    try {
      await this.db.db
        .update(agentPairings)
        .set({
          status: 'approved',
          approvedAt: new Date(),
        })
        .where(eq(agentPairings.code, code));
    } catch (error) {
      this.logger.error(`Failed to approve pairing: ${error}`);
      throw new BadRequestException('Failed to approve pairing');
    }
  }

  /**
   * Consume pairing and get one-time agent token
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

    // Check if already consumed
    if (record.status === 'consumed') {
      throw new BadRequestException('Pairing code already consumed');
    }

    // Check status
    if (record.status !== 'approved') {
      throw new BadRequestException(
        `Pairing must be approved before consuming. Current status: ${record.status}`,
      );
    }

    // Check expiration
    if (new Date() > record.expiresAt) {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(eq(agentPairings.code, code));
      throw new BadRequestException('Pairing code has expired');
    }

    // Generate agent token
    const expiryDays = this.config.get<number>('AGENT_TOKEN_EXPIRY_DAYS') || this.AGENT_TOKEN_EXPIRY_DAYS;
    const tokenPayload = {
      code,
      userId: record.userId,
      type: 'agent',
    };
    const agentToken = this.jwt.sign(tokenPayload, {
      expiresIn: `${expiryDays}d`,
    });

    try {
      await this.db.db
        .update(agentPairings)
        .set({
          status: 'consumed',
          consumedAt: new Date(),
          agentToken,
        })
        .where(eq(agentPairings.code, code));

      return {
        agentToken,
        expiresIn: expiryDays * 24 * 60 * 60, // in seconds
      };
    } catch (error) {
      this.logger.error(`Failed to consume pairing: ${error}`);
      throw new BadRequestException('Failed to consume pairing');
    }
  }
}