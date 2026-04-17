import {
  Controller,
  Get,
  Put,
  Param,
  UseGuards,
  Req,
  Body,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { JobsService } from '../customer/jobs/jobs.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index';
import { Roles } from '../auth/decorators/index';
import { ListJobsResponseDto, JobDetailDto } from '../customer/jobs/dto/index';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  name: string;
}

interface UpdateJobStatusDto {
  status:
    | 'pending'
    | 'queued'
    | 'printing'
    | 'completed'
    | 'failed'
    | 'cancelled';
}

@Controller('owner/jobs')
export class OwnerJobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /owner/jobs/pending
   * OWNER-ONLY - List all jobs pending owner approval for owner's printers
   */
  @Get('pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async listPendingJobs(@Req() req: Request): Promise<ListJobsResponseDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.jobsService.listPendingJobsForOwner(user.userId);
  }

  /**
   * PUT /owner/jobs/:id/status
   * OWNER-ONLY - Update job status (approve/reject)
   */
  @Put(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async updateJobStatus(
    @Param('id') jobId: string,
    @Body() dto: UpdateJobStatusDto,
    @Req() req: Request,
  ): Promise<JobDetailDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    if (!dto.status) {
      throw new BadRequestException('Status is required');
    }

    // Only allow specific status transitions from owner
    const validStatuses = [
      'pending',
      'queued',
      'printing',
      'completed',
      'failed',
      'cancelled',
    ];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    return this.jobsService.updateJobStatus(jobId, dto.status, user.userId);
  }

  /**
   * PUT /owner/jobs/:id/approve
   * OWNER-ONLY - Approve job and move to pending/queued
   */
  @Put(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async approveJob(
    @Param('id') jobId: string,
    @Req() req: Request,
  ): Promise<JobDetailDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    // Approve job by moving it to queued (will be picked up by agent)
    return this.jobsService.updateJobStatus(jobId, 'queued', user.userId);
  }

  /**
   * PUT /owner/jobs/:id/reject
   * OWNER-ONLY - Reject job (move back to queue with different printer)
   */
  @Put(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async rejectJob(
    @Param('id') jobId: string,
    @Req() req: Request,
  ): Promise<JobDetailDto> {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    // Reject job - set status to pending and clear printer assignment
    return this.jobsService.updateJobStatus(jobId, 'pending', user.userId);
  }
}
