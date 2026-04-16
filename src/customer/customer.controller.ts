import {
  Controller,
  Get,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CustomerService } from './customer.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index';
import { Roles } from '../auth/decorators/index';
import { ListCustomerPrintersResponseDto } from './dto/index';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  name: string;
}

@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  /**
   * GET /customer/printers
   * CUSTOMER-ONLY - Fetch orderable printers (online/eligible nodes)
   */
  @Get('printers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  async listAvailablePrinters(
    @Req() req: Request,
  ): Promise<ListCustomerPrintersResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.customerService.listAvailablePrinters();
  }
}
