import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, gt, desc, inArray, count } from 'drizzle-orm';
import { createWriteStream, promises as fsPromises } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

import { DatabaseService } from '../../database/database.service';
import { AgentGateway } from '../../ws/agent.gateway';
import { OwnerGateway } from '../../ws/owner.gateway';
import { jobs, jobFiles, agents, users } from '../../database/schema';
import {
  UploadSTLResponseDto,
  CreateJobRequestDto,
  CreateJobResponseDto,
  JobDetailDto,
  ListJobsResponseDto,
} from './dto/index';

const pipelineAsync = promisify(pipeline);

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
    private readonly agentGateway: AgentGateway,
    private readonly ownerGateway: OwnerGateway,
  ) {
    this.uploadsDir =
      this.configService.get('JOBS_UPLOAD_DIR') || './uploads/jobs';
  }

  private readonly uploadsDir: string;
  private readonly maxFileSize = 500 * 1024 * 1024; // 500MB

  /**
   * Upload an STL file
   */
  async uploadSTL(file: any): Promise<UploadSTLResponseDto> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type
    const allowedMimes = ['application/sla', 'model/stl', 'application/x-stl'];
    const allowedExtensions = ['.stl'];

    const isValidMime = allowedMimes.includes(file.mimetype);
    const hasValidExtension = allowedExtensions.some((ext) =>
      file.originalname.toLowerCase().endsWith(ext),
    );

    if (!isValidMime && !hasValidExtension) {
      throw new BadRequestException('Only STL files are allowed');
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException('File size exceeds 500MB limit');
    }

    // Generate filename and calculate checksum
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}-${randomStr}.stl`;
    const storagePath = join(this.uploadsDir, filename);

    // Calculate SHA256 hash
    const hash = createHash('sha256');
    hash.update(file.buffer);
    const checksum = hash.digest('hex');

    // Ensure upload directory exists
    await fsPromises.mkdir(this.uploadsDir, { recursive: true });

    // Write file to disk
    await fsPromises.writeFile(storagePath, file.buffer);

    // Store in database
    const dbFile = await this.db.db
      .insert(jobFiles)
      .values({
        filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size.toString(),
        storagePath,
        checksum,
      })
      .returning({
        id: jobFiles.id,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
      });

    return {
      file: {
        id: dbFile[0].id,
        filename: dbFile[0].filename,
        originalName: dbFile[0].originalName,
        mimeType: dbFile[0].mimeType,
        size: dbFile[0].size,
        uploadedAt: dbFile[0].uploadedAt,
      },
      message: 'File uploaded successfully',
    };
  }

  /**
   * Find an available printer/agent to assign to a job
   */
  private async findAvailablePrinter(): Promise<string | null> {
    // Find active agents
    const activeAgents = await this.db.db
      .select({
        id: agents.id,
        lastSeenAt: agents.lastSeenAt,
      })
      .from(agents)
      .where(eq(agents.status, 'active'))
      .orderBy(desc(agents.lastSeenAt));

    if (activeAgents.length === 0) {
      return null;
    }

    // Pick the most recently seen agent
    // In a real implementation, you might check WebSocket connectivity via AgentGateway
    return activeAgents[0].id;
  }

  /**
   * Calculate estimated print time based on model dimensions
   */
  calculateEstimatedTime(
    dimensions: { width: number; height: number; depth: number },
    scale: number = 1,
  ): number {
    // Simple volumetric estimation algorithm
    // Base assumption: 1 cm³ takes approximately 60 seconds to print (0.5mm layer height, 60mm/s speed)
    // Convert mm to cm for volume calculation
    const widthCm = (dimensions.width * scale) / 10;
    const heightCm = (dimensions.height * scale) / 10;
    const depthCm = (dimensions.depth * scale) / 10;

    const volumeCm3 = widthCm * heightCm * depthCm;

    // Base time per cm³ (seconds)
    const baseTimePerCm3 = 60;

    // Calculate estimated time
    let estimatedSeconds = volumeCm3 * baseTimePerCm3;

    // Add fixed overhead for setup and cooling
    estimatedSeconds += 300; // 5 minutes setup

    // Minimum print time
    estimatedSeconds = Math.max(estimatedSeconds, 600); // At least 10 minutes

    return Math.round(estimatedSeconds);
  }

  /**
   * Count pending jobs for an owner
   */
  async countPendingJobsForOwner(ownerId: string): Promise<number> {
    // Get all agents belonging to this owner
    const ownerAgents = await this.db.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.ownerId, ownerId), eq(agents.status, 'active')));

    if (ownerAgents.length === 0) {
      return 0;
    }

    const agentIds = ownerAgents.map((agent) => agent.id);

    // Count jobs with pending_owner_approval status for these agents
    const [result] = await this.db.db
      .select({ count: count() })
      .from(jobs)
      .where(
        and(
          inArray(jobs.printerId, agentIds),
          eq(jobs.status, 'pending_owner_approval'),
        ),
      );

    return result?.count ?? 0;
  }

  /**
   * Fetch a pending job with all owner-UI fields for real-time websocket updates
   */
  private async getPendingJobForOwner(
    ownerId: string,
    jobId: string,
  ): Promise<JobDetailDto | null> {
    const rows = await this.db.db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        metadata: jobs.metadata,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
        customerName: users.name,
        printerDisplayName: agents.displayName,
      })
      .from(jobs)
      .innerJoin(jobFiles, eq(jobs.fileId, jobFiles.id))
      .innerJoin(users, eq(jobs.customerId, users.id))
      .innerJoin(agents, eq(jobs.printerId, agents.id))
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, 'pending_owner_approval'),
          eq(agents.ownerId, ownerId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      fileId: row.fileId,
      customerId: row.customerId,
      customerName: row.customerName,
      printerId: row.printerId,
      printerDisplayName: row.printerDisplayName,
      file: {
        id: row.fileId,
        filename: row.filename,
        originalName: row.originalName,
        mimeType: row.mimeType,
        size: row.size,
        uploadedAt: row.uploadedAt,
      },
      metadata: row.metadata,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Notify owner about new pending job via WebSocket
   */
  private async notifyOwnerAboutPendingJob(
    printerId: string,
    jobId?: string,
  ): Promise<void> {
    try {
      // Get owner ID from agent
      const [agent] = await this.db.db
        .select({ ownerId: agents.ownerId })
        .from(agents)
        .where(eq(agents.id, printerId))
        .limit(1);

      if (!agent) {
        this.logger.warn(`Cannot notify owner: agent ${printerId} not found`);
        return;
      }

      // Count pending jobs for this owner
      const pendingCount = await this.countPendingJobsForOwner(agent.ownerId);

      const pendingJob = jobId
        ? await this.getPendingJobForOwner(agent.ownerId, jobId)
        : null;

      // Notify via WebSocket
      this.ownerGateway.notifyNewPendingJobs(
        agent.ownerId,
        pendingCount,
        pendingJob ?? undefined,
      );
      this.logger.log(
        `Notified owner ${agent.ownerId} about ${pendingCount} pending jobs`,
      );
    } catch (error) {
      this.logger.error(`Failed to notify owner about pending job:`, error);
    }
  }

  /**
   * Notify owner about job status update via WebSocket
   */
  private async notifyOwnerAboutJobStatusUpdate(
    jobId: string,
    status: string,
    action: string,
  ): Promise<void> {
    try {
      // Get job details including printerId
      const [job] = await this.db.db
        .select({ printerId: jobs.printerId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job || !job.printerId) {
        this.logger.warn(
          `Cannot notify owner: job ${jobId} has no printer assigned`,
        );
        return;
      }

      // Get owner ID from agent
      const [agent] = await this.db.db
        .select({ ownerId: agents.ownerId })
        .from(agents)
        .where(eq(agents.id, job.printerId))
        .limit(1);

      if (!agent) {
        this.logger.warn(
          `Cannot notify owner: agent ${job.printerId} not found`,
        );
        return;
      }

      // Notify via WebSocket
      this.ownerGateway.notifyJobStatusUpdate(
        agent.ownerId,
        jobId,
        status,
        action,
      );
      this.logger.log(
        `Notified owner ${agent.ownerId} about job ${jobId} ${action}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify owner about job status update:`,
        error,
      );
    }
  }

  /**
   * Create a new job/order
   */
  async createJob(
    customerId: string,
    dto: CreateJobRequestDto,
  ): Promise<CreateJobResponseDto> {
    this.logger.log(`[createJob] Received DTO: ${JSON.stringify(dto)}`);

    if (!dto.fileId) {
      throw new BadRequestException('File ID is required');
    }

    // Verify file exists
    const fileRecord = await this.db.db
      .select()
      .from(jobFiles)
      .where(eq(jobFiles.id, dto.fileId))
      .limit(1);

    if (!fileRecord[0]) {
      throw new NotFoundException('File not found');
    }

    // Find available printer
    const printerId = await this.findAvailablePrinter();

    // Calculate enhanced metadata with estimated time
    let enhancedMetadata = dto.metadata || null;
    if (enhancedMetadata && enhancedMetadata.dimensions) {
      const dimensions = enhancedMetadata.dimensions as {
        width: number;
        height: number;
        depth: number;
      };
      const scale = (enhancedMetadata.scale as number) || 1;
      const estimatedSeconds = this.calculateEstimatedTime(dimensions, scale);
      enhancedMetadata = {
        ...enhancedMetadata,
        estimated_time_seconds: estimatedSeconds,
      };
    }

    // Create job
    const jobRecord = await this.db.db
      .insert(jobs)
      .values({
        customerId,
        fileId: dto.fileId,
        name: dto.name,
        description: dto.description || null,
        metadata: enhancedMetadata,
        printerId,
        status: printerId ? 'pending_owner_approval' : 'pending',
      })
      .returning({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      });

    // Notify owner about new pending job if assigned to a printer
    if (printerId) {
      await this.notifyOwnerAboutPendingJob(printerId, jobRecord[0].id);
    }

    return jobRecord[0];
  }

  /**
   * List all jobs for a customer
   */
  async listCustomerJobs(customerId: string): Promise<ListJobsResponseDto> {
    const rows = await this.db.db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        metadata: jobs.metadata,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
      })
      .from(jobs)
      .innerJoin(jobFiles, eq(jobs.fileId, jobFiles.id))
      .where(eq(jobs.customerId, customerId))
      .orderBy(jobs.createdAt);

    const jobList: JobDetailDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      fileId: row.fileId,
      customerId: row.customerId,
      printerId: row.printerId,
      file: {
        id: row.fileId,
        filename: row.filename,
        originalName: row.originalName,
        mimeType: row.mimeType,
        size: row.size,
        uploadedAt: row.uploadedAt,
      },
      metadata: row.metadata,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return {
      jobs: jobList,
      count: jobList.length,
    };
  }

  /**
   * Get a specific job with ownership check
   */
  async getJobDetail(jobId: string, customerId: string): Promise<JobDetailDto> {
    const row = await this.db.db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        metadata: jobs.metadata,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
      })
      .from(jobs)
      .innerJoin(jobFiles, eq(jobs.fileId, jobFiles.id))
      .where(and(eq(jobs.id, jobId), eq(jobs.customerId, customerId)))
      .limit(1);

    if (!row[0]) {
      throw new NotFoundException('Job not found');
    }

    const r = row[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      fileId: r.fileId,
      customerId: r.customerId,
      printerId: r.printerId,
      file: {
        id: r.fileId,
        filename: r.filename,
        originalName: r.originalName,
        mimeType: r.mimeType,
        size: r.size,
        uploadedAt: r.uploadedAt,
      },
      metadata: r.metadata,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * List jobs pending owner approval for a specific printer owner
   */
  async listPendingJobsForOwner(ownerId: string): Promise<ListJobsResponseDto> {
    // Find all agents belonging to this owner
    const ownerAgents = await this.db.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.ownerId, ownerId), eq(agents.status, 'active')));

    if (ownerAgents.length === 0) {
      return { jobs: [], count: 0 };
    }

    const agentIds = ownerAgents.map((agent) => agent.id);

    // Get jobs with pending_owner_approval status for these agents
    const rows = await this.db.db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        metadata: jobs.metadata,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
        customerName: users.name,
        printerDisplayName: agents.displayName,
      })
      .from(jobs)
      .innerJoin(jobFiles, eq(jobs.fileId, jobFiles.id))
      .innerJoin(users, eq(jobs.customerId, users.id))
      .innerJoin(agents, eq(jobs.printerId, agents.id))
      .where(
        and(
          inArray(jobs.printerId, agentIds),
          eq(jobs.status, 'pending_owner_approval'),
        ),
      )
      .orderBy(jobs.createdAt);

    const jobList: JobDetailDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      fileId: row.fileId,
      customerId: row.customerId,
      customerName: row.customerName,
      printerId: row.printerId,
      printerDisplayName: row.printerDisplayName,
      file: {
        id: row.fileId,
        filename: row.filename,
        originalName: row.originalName,
        mimeType: row.mimeType,
        size: row.size,
        uploadedAt: row.uploadedAt,
      },
      metadata: row.metadata,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return {
      jobs: jobList,
      count: jobList.length,
    };
  }

  /**
   * Update job status (for owner approval/denial)
   */
  async updateJobStatus(
    jobId: string,
    status: string,
    ownerId?: string,
  ): Promise<JobDetailDto> {
    // Verify ownership if ownerId provided
    if (ownerId) {
      const job = await this.db.db
        .select({ printerId: jobs.printerId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job[0] || !job[0].printerId) {
        throw new NotFoundException('Job not found or no printer assigned');
      }

      // Check if printer belongs to owner
      const printer = await this.db.db
        .select({ ownerId: agents.ownerId })
        .from(agents)
        .where(eq(agents.id, job[0].printerId))
        .limit(1);

      if (!printer[0] || printer[0].ownerId !== ownerId) {
        throw new ForbiddenException('Not authorized to update this job');
      }
    }

    // Update job status and timestamps
    const now = new Date();
    const updateData: any = {
      status: status as any,
      updatedAt: now,
      // If status becomes 'pending', clear printerId (job goes back to queue)
      printerId: status === 'pending' ? null : undefined,
    };

    // Update startedAt when job starts printing
    if (status === 'printing') {
      updateData.startedAt = now;
    }

    // Update completedAt when job finishes (completed, failed, cancelled)
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      updateData.completedAt = now;
    }

    // Clear timestamps when job is reset to pending/queued
    if (['pending', 'queued'].includes(status)) {
      updateData.startedAt = null;
      updateData.completedAt = null;
    }

    const updatedJob = await this.db.db
      .update(jobs)
      .set(updateData)
      .where(eq(jobs.id, jobId))
      .returning({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        status: jobs.status,
        fileId: jobs.fileId,
        customerId: jobs.customerId,
        printerId: jobs.printerId,
        metadata: jobs.metadata,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      });

    if (!updatedJob[0]) {
      throw new NotFoundException('Job not found');
    }

    // Notify agent if job is queued and has a printer assigned
    if (status === 'queued' && updatedJob[0].printerId) {
      try {
        this.agentGateway.assignJobToAgent(updatedJob[0].printerId, {
          id: updatedJob[0].id,
          name: updatedJob[0].name,
          fileId: updatedJob[0].fileId,
          metadata: updatedJob[0].metadata,
        });
        this.logger.log(
          `Notified agent ${updatedJob[0].printerId} about job ${updatedJob[0].id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to notify agent about job ${updatedJob[0].id}:`,
          error,
        );
      }
    }

    // Get file details for response
    const fileRow = await this.db.db
      .select({
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
      })
      .from(jobFiles)
      .where(eq(jobFiles.id, updatedJob[0].fileId))
      .limit(1);

    const file = fileRow[0];

    // Notify owner about job status update if printer is assigned
    if (updatedJob[0].printerId) {
      const action =
        status === 'queued'
          ? 'approved'
          : status === 'pending'
            ? 'rejected'
            : status.toLowerCase();
      await this.notifyOwnerAboutJobStatusUpdate(jobId, status, action);
    }

    return {
      id: updatedJob[0].id,
      name: updatedJob[0].name,
      description: updatedJob[0].description,
      status: updatedJob[0].status,
      fileId: updatedJob[0].fileId,
      customerId: updatedJob[0].customerId,
      printerId: updatedJob[0].printerId,
      file: {
        id: updatedJob[0].fileId,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        uploadedAt: file.uploadedAt,
      },
      metadata: updatedJob[0].metadata,
      startedAt: updatedJob[0].startedAt,
      completedAt: updatedJob[0].completedAt,
      createdAt: updatedJob[0].createdAt,
      updatedAt: updatedJob[0].updatedAt,
    };
  }
}
