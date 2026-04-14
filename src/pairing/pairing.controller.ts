import { Controller, Post, Get, Body, Param, UseGuards, Request, Logger, BadRequestException } from '@nestjs/common';
import { PairingService } from './pairing.service';
import { PairStartDto, PairStartResponseDto, PairStatusResponseDto, PairConsumeResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/guards';

@Controller('agent/pair')
export class PairingController {
  private logger = new Logger('PairingController');

  constructor(private pairingService: PairingService) {}

  /**
   * POST /agent/pair/start
   * Start a new pairing request from an agent
   */
  @Post('start')
  async startPairing(@Body() dto: PairStartDto): Promise<PairStartResponseDto> {
    // Log the actual request
    this.logger.log(`Pairing request received: ${JSON.stringify(dto)}`);

    // Validate required fields
    if (!dto.nodeId || !dto.agentName) {
      throw new BadRequestException(
        `Missing required fields. Received: nodeId="${dto.nodeId}", agentName="${dto.agentName}"`
      );
    }

    this.logger.log(`Starting pairing for node: ${dto.nodeId}, agent: ${dto.agentName}`);
    return this.pairingService.startPairing(dto);
  }

  /**
   * GET /agent/pair/:code/status
   * Check the status of a pairing code
   */
  @Get(':code/status')
  async getPairingStatus(@Param('code') code: string): Promise<PairStatusResponseDto> {
    this.logger.log(`Checking status for code: ${code}`);
    return this.pairingService.getPairingStatus(code);
  }

  /**
   * POST /agent/pair/:code/consume
   * Consume a pairing code after approval
   */
  @Post(':code/consume')
  async consumePairing(@Param('code') code: string): Promise<PairConsumeResponseDto> {
    this.logger.log(`Consuming pairing code: ${code}`);
    return this.pairingService.consumePairing(code);
  }

  /**
   * POST /agent/pair/:code/approve
   * Approve a pairing code (called from web UI after user sign-in)
   * Requires JWT auth
   */
  @Post(':code/approve')
  @UseGuards(JwtAuthGuard)
  async approvePairing(@Param('code') code: string, @Request() req: any): Promise<{ status: string }> {
    this.logger.log(`Approving pairing code: ${code} for user: ${req.user.userId}`);
    await this.pairingService.approvePairing(code, req.user.userId);
    return { status: 'approved' };
  }
}
