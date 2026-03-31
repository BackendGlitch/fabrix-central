import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  Body,
  Delete,
} from '@nestjs/common';
import type { Request } from 'express';

import { PairingService } from './pairing.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index';
import { Roles } from '../auth/decorators/index';
import {
  StartPairingResponseDto,
  StartPairingRequestDto,
  PairingStatusDto,
  ConsumePairingDto,
} from './dto/index';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  name: string;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Controller('agent/pair')
export class PairingController {
  constructor(private readonly pairingService: PairingService) {}

  /**
   * POST /agent/pair/start
   * UNAUTHENTICATED - Desktop app creates pending pairing without owner
   */
  @Post('start')
  async startPairing(
    @Body() dto: StartPairingRequestDto,
    @Req() req: Request,
  ): Promise<StartPairingResponseDto> {
    return this.pairingService.startPairing(dto || {}, this.getRequestMeta(req));
  }

  /**
   * GET /agent/pair/:code/status
   * PUBLIC - Check pairing status (no auth required)
   */
  @Get(':code/status')
  async getPairingStatus(
    @Param('code') code: string,
    @Req() req: Request,
  ): Promise<PairingStatusDto> {
    return this.pairingService.getPairingStatus(code, this.getRequestMeta(req));
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

    return this.pairingService.approvePairing(code, user.userId, this.getRequestMeta(req));
  }

  /**
   * POST /agent/pair/:code/consume
   * PUBLIC - Exchange approved code for standard auth tokens
   * Response: { accessToken, refreshToken, user }
   */
  @Post(':code/consume')
  async consumePairing(
    @Param('code') code: string,
    @Req() req: Request,
  ): Promise<ConsumePairingDto> {
    return this.pairingService.consumePairing(code, this.getRequestMeta(req));
  }

  @Get('owner/agents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async listOwnerAgents(@Req() req: Request) {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.pairingService.listOwnerAgents(user.userId);
  }

  @Delete('owner/agents/:agentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async revokeOwnerAgent(@Param('agentId') agentId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }
    await this.pairingService.revokeOwnerAgent(user.userId, agentId);
    return { message: 'Agent revoked' };
  }

  private getRequestMeta(req: Request): RequestMeta {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0]?.trim();

    return {
      ip: ip ?? req.ip,
      userAgent: req.headers['user-agent'],
    };
  }
}
