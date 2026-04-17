import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  UnauthorizedException,
  StreamableFile,
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { eq, and } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { AgentAuthService } from '../agent-auth/agent-auth.service';
import { jobFiles, jobs } from '../database/schema';

interface AgentAuthContext {
  agentId: string;
  ownerId: string;
}

interface RequestWithAgent extends Request {
  agent: AgentAuthContext;
}

@Injectable()
export class AgentAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentAuthGuard.name);

  constructor(private readonly agentAuth: AgentAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    try {
      const authContext = this.agentAuth.verifyAccessToken(token);

      // Ensure agent is still active
      const isActive = await this.agentAuth.isAgentActive(authContext.agentId);
      if (!isActive) {
        throw new UnauthorizedException('Agent has been revoked');
      }

      (request as RequestWithAgent).agent = authContext;
      this.logger.debug(`Agent ${authContext.agentId} authenticated`);
      return true;
    } catch (error) {
      this.logger.warn(`Agent authentication failed: ${error.message}`);
      throw new UnauthorizedException('Invalid agent token');
    }
  }
}

@Controller('agent/jobs')
export class AgentFilesController {
  private readonly logger = new Logger(AgentFilesController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly agentAuth: AgentAuthService,
  ) {}

  /**
   * GET /agent/jobs/files/:fileId/download
   * AGENT-ONLY - Download an STL file assigned to the agent
   */
  @Get('files/:fileId/download')
  @UseGuards(AgentAuthGuard)
  async downloadFile(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const agent = (req as RequestWithAgent).agent;

    // Verify the agent has access to this file through an assigned job
    const fileRecord = await this.db.db
      .select({
        id: jobFiles.id,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        storagePath: jobFiles.storagePath,
        mimeType: jobFiles.mimeType,
      })
      .from(jobFiles)
      .innerJoin(jobs, eq(jobs.fileId, jobFiles.id))
      .where(
        and(
          eq(jobFiles.id, fileId),
          eq(jobs.printerId, agent.agentId),
        ),
      )
      .limit(1);

    if (!fileRecord[0]) {
      this.logger.warn(
        `Agent ${agent.agentId} attempted to download file ${fileId} without access`,
      );
      throw new NotFoundException('File not found or access denied');
    }

    const file = fileRecord[0];
    const filePath = join(process.cwd(), file.storagePath);

    if (!existsSync(filePath)) {
      this.logger.error(`File not found on disk: ${filePath}`);
      throw new NotFoundException('File not found on disk');
    }

    this.logger.log(
      `Agent ${agent.agentId} downloading file ${file.originalName} (${fileId})`,
    );

    // Update agent's last seen timestamp
    await this.agentAuth.touchLastSeen(agent.agentId);

    const stream = createReadStream(filePath);

    // Set appropriate headers
    res.set({
      'Content-Type': file.mimeType || 'application/sla',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      'Content-Length': (await import('fs')).statSync(filePath).size.toString(),
    });

    return new StreamableFile(stream);
  }

  /**
   * GET /agent/jobs/files/:fileId/info
   * AGENT-ONLY - Get file metadata
   */
  @Get('files/:fileId/info')
  @UseGuards(AgentAuthGuard)
  async getFileInfo(
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ) {
    const agent = (req as RequestWithAgent).agent;

    const fileRecord = await this.db.db
      .select({
        id: jobFiles.id,
        filename: jobFiles.filename,
        originalName: jobFiles.originalName,
        mimeType: jobFiles.mimeType,
        size: jobFiles.size,
        uploadedAt: jobFiles.uploadedAt,
        checksum: jobFiles.checksum,
      })
      .from(jobFiles)
      .innerJoin(jobs, eq(jobs.fileId, jobFiles.id))
      .where(
        and(
          eq(jobFiles.id, fileId),
          eq(jobs.printerId, agent.agentId),
        ),
      )
      .limit(1);

    if (!fileRecord[0]) {
      throw new NotFoundException('File not found or access denied');
    }

    return fileRecord[0];
  }
}
