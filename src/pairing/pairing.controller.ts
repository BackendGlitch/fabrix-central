import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PairingService } from './pairing.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index';
import { Roles } from '../auth/decorators/index';
import {
  StartPairingResponseDto,
  PairingStatusDto,
  ConsumePairingDto,
} from './dto/index';

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

@Controller('agent/pair')
export class PairingController {
  constructor(private readonly pairingService: PairingService) {}

  /**
   * POST /agent/pair/start
   * Start pairing flow - generates pairing code
   */
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startPairing(@Req() req: Request): Promise<StartPairingResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.id) {
      throw new BadRequestException('User not authenticated');
    }

    const agentName = (req.body as any)?.agentName;
    return this.pairingService.startPairing(user.id, agentName);
  }

  /**
   * GET /agent/pair/:code/status
   * Check pairing status - no auth required
   */
  @Get(':code/status')
  async getPairingStatus(@Param('code') code: string): Promise<PairingStatusDto> {
    return this.pairingService.getPairingStatus(code);
  }

  /**
   * POST /agent/pair/:code/approve
   * Approve pairing - OWNER only
   */
  @Post(':code/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async approvePairing(
    @Param('code') code: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const user = req.user as AuthUser;
    if (!user || !user.id) {
      throw new BadRequestException('User not authenticated');
    }

    await this.pairingService.approvePairing(code, user.id);
    return { message: 'Pairing approved successfully' };
  }

  /**
   * POST /agent/pair/:code/consume
   * Consume pairing and get agent token - no auth required
   */
  @Post(':code/consume')
  async consumePairing(@Param('code') code: string): Promise<ConsumePairingDto> {
    return this.pairingService.consumePairing(code);
  }
}