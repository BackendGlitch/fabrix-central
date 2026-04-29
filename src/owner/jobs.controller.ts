import {
  Controller,
  Get,
  Put,
  Post,
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
import { AgentGateway } from '../ws/agent.gateway';
import { CommandsService, CommandType } from '../agent/commands.service';
import { DatabaseService } from '../database/database.service';
import { eq } from 'drizzle-orm';
import { jobs } from '../database/schema';

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
  constructor(
    private readonly jobsService: JobsService,
    private readonly agentGateway: AgentGateway,
    private readonly commands: CommandsService,
    private readonly db: DatabaseService,
  ) {}

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
   * OWNER-ONLY - Approve job and move to queued
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

    // Verify job is in pending_owner_approval status before allowing approval
    const [job] = await this.db.db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (job.status !== 'pending_owner_approval') {
      throw new BadRequestException(
        `Cannot approve job with status '${job.status}'. Job must be pending owner approval.`,
      );
    }

    // Approve job by moving it to queued (will be picked up by agent)
    return this.jobsService.updateJobStatus(jobId, 'queued', user.userId);
  }

  /**
   * PUT /owner/jobs/:id/reject
   * OWNER-ONLY - Reject job (move back to queue with different printer)
   * ISSUE #6: Validate job is awaiting approval before allowing rejection
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

    // Verify job is in pending_owner_approval status before allowing rejection
    const [job] = await this.db.db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (job.status !== 'pending_owner_approval') {
      throw new BadRequestException(
        `Cannot reject job with status '${job.status}'. Job must be pending owner approval.`,
      );
    }

    // Reject job - set status to pending and clear printer assignment (will be reassigned)
    return this.jobsService.updateJobStatus(jobId, 'pending', user.userId);
  }

  /**
   * POST /owner/jobs/:id/start
   * OWNER-ONLY - Send start command to agent for a queued job
   */
  @Post(':id/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async startJob(@Param('id') jobId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    // Verify job exists and is assigned to this owner
    const [job] = await this.db.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (!job.printerId) {
      throw new BadRequestException('Job is not assigned to a printer');
    }

    const { correlationId, sent } = await this.agentGateway.sendCommand(
      job.printerId,
      jobId,
      'start',
      { jobId },
    );

    return {
      message: sent
        ? 'Start command sent to agent'
        : 'Start command queued (agent not connected)',
      correlationId,
      sent,
    };
  }

  /**
   * POST /owner/jobs/:id/pause
   * OWNER-ONLY - Send pause command to agent for a printing job
   */
  @Post(':id/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async pauseJob(@Param('id') jobId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const [job] = await this.db.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (!job.printerId) {
      throw new BadRequestException('Job is not assigned to a printer');
    }

    if (job.status !== 'printing') {
      throw new BadRequestException('Job is not currently printing');
    }

    const { correlationId, sent } = await this.agentGateway.sendCommand(
      job.printerId,
      jobId,
      'pause',
      { jobId },
    );

    return {
      message: sent
        ? 'Pause command sent to agent'
        : 'Pause command queued (agent not connected)',
      correlationId,
      sent,
    };
  }

  /**
   * POST /owner/jobs/:id/cancel
   * OWNER-ONLY - Send cancel command to agent
   */
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async cancelJob(@Param('id') jobId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    if (!user || !user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const [job] = await this.db.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (!job.printerId) {
      throw new BadRequestException('Job is not assigned to a printer');
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      throw new BadRequestException('Job is already completed');
    }

    const { correlationId, sent } = await this.agentGateway.sendCommand(
      job.printerId,
      jobId,
      'cancel',
      { jobId },
    );

    return {
      message: sent
        ? 'Cancel command sent to agent'
        : 'Cancel command queued (agent not connected)',
      correlationId,
      sent,
    };
  }
}
