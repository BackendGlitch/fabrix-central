import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { pairingCodes, agents, users } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { PairStartDto, PairStatusResponseDto, PairConsumeResponseDto } from './dto';

@Injectable()
export class PairingService {
  private logger = new Logger('PairingService');

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
  ) {}

  /**
   * Start a new pairing request from an agent
   */
  async startPairing(dto: PairStartDto): Promise<{ pairing_code: string; login_url: string }> {
    try {
      // Generate a 6-digit pairing code
      const code = this.generateCode();

      // Code expires in 10 minutes
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      // Insert pairing code
      const result = await this.db.db.insert(pairingCodes).values({
        code: code,
        nodeId: dto.nodeId,
        agentName: dto.agentName,
        appVersion: dto.appVersion || null,
        status: 'pending',
        expiresAt: expiresAt,
      }).returning();

      if (!result || result.length === 0) {
        throw new Error('Failed to insert pairing code');
      }

      this.logger.log(`Pairing code created: ${code} for node ${dto.nodeId}`);

      // Build login URL - this should point to a pairing approval page in the web app
      // Format: http://localhost:3000/agent/auth?code=XXXXXX&node=nodeId&name=agentName
      const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
      const loginUrl = `${webAppUrl}/agent/auth?code=${code}&node=${encodeURIComponent(dto.nodeId)}&name=${encodeURIComponent(dto.agentName)}`;

      return {
        pairing_code: code,
        login_url: loginUrl,
      };
    } catch (error) {
      this.logger.error('Error starting pairing', error);
      throw error;
    }
  }

  /**
   * Check the status of a pairing code
   */
  async getPairingStatus(code: string): Promise<PairStatusResponseDto> {
    const pairingCode = await this.db.db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (!pairingCode || pairingCode.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const pairing = pairingCode[0];

    // Check if expired
    if (new Date() > pairing.expiresAt) {
      if (pairing.status !== 'expired') {
        await this.db.db
          .update(pairingCodes)
          .set({ status: 'expired' })
          .where(eq(pairingCodes.code, code));
      }
      return { status: 'expired' };
    }

    return { status: pairing.status as any };
  }

  /**
   * Approve a pairing code (called from web UI after user signs in)
   */
  async approvePairing(code: string, ownerId: string): Promise<void> {
    const pairingCode = await this.db.db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (!pairingCode || pairingCode.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const pairing = pairingCode[0];

    // Check if expired
    if (new Date() > pairing.expiresAt) {
      throw new BadRequestException('Pairing code has expired');
    }

    if (pairing.status !== 'pending') {
      throw new BadRequestException(`Pairing code is ${pairing.status}, cannot approve`);
    }

    // Update status to approved and set owner
    await this.db.db
      .update(pairingCodes)
      .set({
        status: 'approved',
        ownerId,
        approvedAt: new Date(),
      })
      .where(eq(pairingCodes.code, code));

    this.logger.log(`Pairing code ${code} approved by user ${ownerId}`);
  }

  /**
   * Consume a pairing code and create agent/credentials (called from agent after approval)
   */
  async consumePairing(code: string): Promise<PairConsumeResponseDto> {
    const pairingCode = await this.db.db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (!pairingCode || pairingCode.length === 0) {
      throw new NotFoundException('Pairing code not found');
    }

    const pairing = pairingCode[0];

    // Check if expired
    if (new Date() > pairing.expiresAt) {
      throw new BadRequestException('Pairing code has expired');
    }

    if (pairing.status === 'already_consumed') {
      return { status: 'already_consumed' };
    }

    if (pairing.status !== 'approved') {
      throw new BadRequestException(`Pairing code is ${pairing.status}, must be approved first`);
    }

    if (!pairing.ownerId) {
      throw new BadRequestException('Pairing code has no owner assigned');
    }

    // Create or update agent entry
    const existingAgent = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.ownerId, pairing.ownerId), eq(agents.nodeId, pairing.nodeId)))
      .limit(1);

    let agentId: string;
    if (existingAgent && existingAgent.length > 0) {
      agentId = existingAgent[0].id;
      // Update existing agent
      await this.db.db
        .update(agents)
        .set({
          status: 'paired',
          displayName: pairing.agentName,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));
    } else {
      // Create new agent
      const newAgent = await this.db.db
        .insert(agents)
        .values({
          ownerId: pairing.ownerId,
          nodeId: pairing.nodeId,
          displayName: pairing.agentName,
          status: 'paired',
        })
        .returning();
      agentId = newAgent[0].id;
    }

    // Get agent and owner info
    const agentData = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    const ownerData = await this.db.db
      .select()
      .from(users)
      .where(eq(users.id, pairing.ownerId))
      .limit(1);

    const agent = agentData[0];
    const owner = ownerData[0];

    // Generate JWT tokens for agent
    const accessToken = this.jwtService.sign(
      {
        sub: agent.id,
        nodeId: agent.nodeId,
        ownerId: agent.ownerId,
        type: 'agent',
      },
      { expiresIn: '24h' },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: agent.id,
        type: 'agent_refresh',
      },
      { expiresIn: '7d' },
    );

    // Mark pairing code as consumed
    await this.db.db
      .update(pairingCodes)
      .set({
        status: 'consumed',
        consumedAt: new Date(),
      })
      .where(eq(pairingCodes.code, code));

    this.logger.log(`Pairing code ${code} consumed for agent ${agent.id}`);

    return {
      status: 'success',
      accessToken,
      refreshToken,
      agent: {
        id: agent.id,
        nodeId: agent.nodeId,
        displayName: agent.displayName || pairing.agentName,
        ownerId: agent.ownerId,
        ownerEmail: owner?.email,
      },
    };
  }

  /**
   * Generate a random 6-digit code
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
