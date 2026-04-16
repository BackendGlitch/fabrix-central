import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import { JobsService } from './jobs.service';
import { JwtAuthGuard, RolesGuard } from '../../auth/guards/index';
import { Roles } from '../../auth/decorators/index';
import {
  CreateJobRequestDto,
  CreateJobResponseDto,
  JobDetailDto,
  ListJobsResponseDto,
  UploadSTLResponseDto,
} from './dto/index';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  name: string;
}

@Controller('customer/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * POST /customer/jobs/upload
   * CUSTOMER-ONLY - Upload an STL file
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSTL(
    @UploadedFile() file: any,
    @Req() req: Request,
  ): Promise<UploadSTLResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.jobsService.uploadSTL(file);
  }

  /**
   * POST /customer/jobs
   * CUSTOMER-ONLY - Create a new job/order
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  async createJob(
    @Body() dto: CreateJobRequestDto,
    @Req() req: Request,
  ): Promise<CreateJobResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.jobsService.createJob(user.userId, dto);
  }

  /**
   * GET /customer/jobs/me
   * CUSTOMER-ONLY - List all jobs for authenticated customer
   */
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  async listMyJobs(@Req() req: Request): Promise<ListJobsResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.jobsService.listCustomerJobs(user.userId);
  }

  /**
   * GET /customer/jobs/:id
   * CUSTOMER-ONLY - Get job details (with ownership check)
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  async getJobDetail(
    @Param('id') jobId: string,
    @Req() req: Request,
  ): Promise<JobDetailDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.jobsService.getJobDetail(jobId, user.userId);
  }
}
