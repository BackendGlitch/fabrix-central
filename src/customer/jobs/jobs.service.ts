import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { createWriteStream, promises as fsPromises } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

import { DatabaseService } from '../../database/database.service';
import { jobs, jobFiles } from '../../database/schema';
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
  private readonly uploadsDir: string;
  private readonly maxFileSize = 500 * 1024 * 1024; // 500MB

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get('JOBS_UPLOAD_DIR') || './uploads/jobs';
  }

  /**
   * Upload an STL file
   */
  async uploadSTL(
    file: any,
  ): Promise<UploadSTLResponseDto> {
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

    // Create job
    const jobRecord = await this.db.db
      .insert(jobs)
      .values({
        customerId,
        fileId: dto.fileId,
        name: dto.name,
        description: dto.description || null,
        metadata: dto.metadata || null,
        status: 'pending',
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
}
