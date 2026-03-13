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
  userId: string;
  email: string;
  role: string;
  name: string;
}

@Controller('agent/pair')
export class PairingController {
  constructor(private readonly pairingService: PairingService) {}

  /**
   * POST /agent/pair/start
   * UNAUTHENTICATED - Desktop app creates pending pairing without owner
   */
  @Post('start')
  async startPairing(@Req() req: Request): Promise<StartPairingResponseDto> {
    const body = req.body as any;
    const agentName = body?.agentName;
    return this.pairingService.startPairing(agentName);
  }

  /**
   * GET /agent/pair/:code/status
   * PUBLIC - Check pairing status (no auth required)
   */
  @Get(':code/status')
  async getPairingStatus(@Param('code') code: string): Promise<PairingStatusDto> {
    return this.pairingService.getPairingStatus(code);
  }

  /**
   * POST /agent/pair/:code/approve
   * OWNER-ONLY - Sets owner_id on the pairing
   */
  @Post(':code/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async approvePairing(@Param('code') code: string, @Req() req: Request): Promise<{ message: string }> {
    const user = req.user as AuthUser;
if (!user || !user.userId) {
  throw new BadRequestException('User not authenticated');
}

return this.pairingService.approvePairing(code, user.userId);
  }

  /**
   * POST /agent/pair/:code/consume
   * PUBLIC - Exchange approved code for standard auth tokens
   * Response: { accessToken, refreshToken, user }
   */
  @Post(':code/consume')
  async consumePairing(@Param('code') code: string): Promise<ConsumePairingDto> {
    return this.pairingService.consumePairing(code);
  }
}