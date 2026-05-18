import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  Patch,
  Delete,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PricingService, PricingCalculationInput } from './pricing.service';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

// DTOs
class CalculatePriceDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsOptional()
  printerConfigId?: string;

  @IsString()
  @IsOptional()
  filamentId?: string;

  @IsNumber()
  @IsOptional()
  scale?: number;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  printSettings?: {
    infillPercent?: number;
    layerHeight?: string;
    wallCount?: number;
    supportEnabled?: boolean;
  };
}

class CreateFilamentDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsOptional()
  colorHex?: string;

  @IsString()
  @IsNotEmpty()
  pricePerGram!: string;

  @IsNumber()
  @IsOptional()
  stockGrams?: number;

  @IsNumber()
  @IsOptional()
  nozzleTemp?: number;

  @IsNumber()
  @IsOptional()
  bedTemp?: number;

  @IsNumber()
  @IsOptional()
  printSpeed?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

class UpdateFilamentDto {
  brand?: string;
  color?: string;
  colorHex?: string;
  pricePerGram?: string;
  stockGrams?: number;
  isAvailable?: boolean;
  nozzleTemp?: number;
  bedTemp?: number;
  printSpeed?: number;
  notes?: string;
}

class UpdatePrinterConfigDto {
  bedWidth?: number;
  bedDepth?: number;
  bedHeight?: number;
  nozzleDiameter?: string;
  hourlyRate?: string;
  defaultLayerHeight?: string;
  defaultInfillPercent?: number;
  defaultWallCount?: number;
  supportsMultiMaterial?: boolean;
  hasHeatedBed?: boolean;
  maxNozzleTemp?: number;
  maxBedTemp?: number;
  capabilities?: Record<string, unknown>;
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * Calculate price for a print job (public endpoint, requires auth)
   */
  @Post('calculate')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async calculatePrice(@Body() dto: CalculatePriceDto) {
    const breakdown = await this.pricingService.calculatePrice(dto);

    return {
      success: true,
      data: breakdown,
    };
  }

  /**
   * Calculate batch price for multiple copies
   */
  @Post('calculate-batch')
  @UseGuards(JwtAuthGuard)
  async calculateBatchPrice(@Body() dto: CalculatePriceDto) {
    const input: PricingCalculationInput = {
      fileId: dto.fileId,
      printerConfigId: dto.printerConfigId,
      filamentId: dto.filamentId,
      scale: dto.scale ?? 1,
      quantity: dto.quantity ?? 1,
      printSettings: dto.printSettings,
    };

    const result = await this.pricingService.calculateBatchPrice(input);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Create a price quote (expires after 1 hour by default)
   */
  @Post('quote')
  @UseGuards(JwtAuthGuard)
  async createQuote(
    @Body() dto: CalculatePriceDto,
    @Query('expiresInMinutes') expiresInMinutes?: number,
  ) {
    const input: PricingCalculationInput = {
      fileId: dto.fileId,
      printerConfigId: dto.printerConfigId,
      filamentId: dto.filamentId,
      scale: dto.scale ?? 1,
      printSettings: dto.printSettings,
    };

    const quoteId = await this.pricingService.createQuote(
      input,
      expiresInMinutes ?? 60,
    );

    return {
      success: true,
      quoteId,
      expiresIn: `${expiresInMinutes ?? 60} minutes`,
    };
  }

  /**
   * Get available filaments for a printer configuration
   */
  @Get('filaments/:printerConfigId')
  @UseGuards(JwtAuthGuard)
  async getAvailableFilaments(
    @Param('printerConfigId', ParseUUIDPipe) printerConfigId: string,
  ) {
    const filaments =
      await this.pricingService.getAvailableFilaments(printerConfigId);
    return {
      success: true,
      count: filaments.length,
      data: filaments,
    };
  }

  /**
   * Get all filament standards (platform defaults)
   */
  @Get('filament-standards')
  @UseGuards(JwtAuthGuard)
  async getFilamentStandards() {
    const standards = await this.pricingService.getFilamentStandards();
    return {
      success: true,
      count: standards.length,
      data: standards,
    };
  }

  // ===== OWNER ENDPOINTS =====

  /**
   * Get or create printer config for an agent (OWNER only)
   */
  @Get('owner/agents/:agentId/config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getOrCreatePrinterConfig(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    if (!user?.userId) {
      throw new NotFoundException('User not authenticated');
    }
    const config = await this.pricingService.getOrCreatePrinterConfig(
      agentId,
      user.userId,
    );
    return {
      success: true,
      data: config,
    };
  }

  /**
   * Create or update printer config (OWNER only)
   */
  @Post('owner/agents/:agentId/config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async savePrinterConfig(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: UpdatePrinterConfigDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    if (!user?.userId) {
      throw new NotFoundException('User not authenticated');
    }
    const config = await this.pricingService.savePrinterConfig(
      agentId,
      user.userId,
      dto,
    );
    return {
      success: true,
      data: config,
    };
  }

  /**
   * Add filament to printer inventory (OWNER only)
   */
  @Post('owner/printers/:printerConfigId/filaments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addFilament(
    @Param('printerConfigId', ParseUUIDPipe) printerConfigId: string,
    @Body() dto: CreateFilamentDto,
  ) {
    const filament = await this.pricingService.addFilament(printerConfigId, dto);
    return {
      success: true,
      message: 'Filament added successfully',
      data: filament,
    };
  }

  /**
   * Update filament (OWNER only)
   */
  @Patch('owner/printers/:printerConfigId/filaments/:filamentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async updateFilament(
    @Param('printerConfigId', ParseUUIDPipe) printerConfigId: string,
    @Param('filamentId', ParseUUIDPipe) filamentId: string,
    @Body() dto: UpdateFilamentDto,
  ) {
    const filament = await this.pricingService.updateFilament(
      filamentId,
      dto,
    );
    return {
      success: true,
      message: 'Filament updated successfully',
      data: filament,
    };
  }

  /**
   * Delete filament (OWNER only)
   */
  @Delete('owner/printers/:printerConfigId/filaments/:filamentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async deleteFilament(
    @Param('printerConfigId', ParseUUIDPipe) printerConfigId: string,
    @Param('filamentId', ParseUUIDPipe) filamentId: string,
  ) {
    await this.pricingService.deleteFilament(filamentId);
    return {
      success: true,
      message: 'Filament deleted successfully',
    };
  }

  /**
   * Update printer configuration (OWNER only)
   */
  @Patch('owner/printers/:printerConfigId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async updatePrinterConfig(
    @Param('printerConfigId', ParseUUIDPipe) printerConfigId: string,
    @Body() dto: UpdatePrinterConfigDto,
  ) {
    const config = await this.pricingService.updatePrinterConfig(
      printerConfigId,
      dto,
    );
    return {
      success: true,
      message: 'Printer configuration updated',
      data: config,
    };
  }
}
