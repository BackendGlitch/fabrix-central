import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { AgentAuthService } from '../agent-auth/agent-auth.service';
import { DatabaseService } from '../database/database.service';

import { eq } from 'drizzle-orm';
import { jobs } from '../database/schema';

type AgentActivityState = 'idle' | 'working';

interface AgentRuntimeState {
  connected: boolean;
  activityState: AgentActivityState | 'offline';
  lastHeartbeatAt: Date | null;
}

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(AgentGateway.name);
  private readonly contexts = new WeakMap<
    WebSocket,
    { agentId: string; ownerId: string }
  >();
  private readonly socketCountByAgent = new Map<string, number>();
  private readonly activityByAgent = new Map<string, AgentActivityState>();
  private readonly lastHeartbeatByAgent = new Map<string, Date>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly agentAuth: AgentAuthService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit() {
    // Redis pub/sub disabled — will be re-enabled when Redis is configured
    this.logger.log('AgentGateway initialized (Redis pub/sub skipped)');
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const token = this.extractBearerToken(request);
    if (!token) {
      client.close(1008, 'Unauthorized');
      return;
    }

    try {
      const context = this.agentAuth.verifyAccessToken(token);
      const active = await this.agentAuth.isAgentActive(context.agentId);
      if (!active) {
        client.close(1008, 'Agent revoked');
        return;
      }
      this.contexts.set(client, context);
      this.markConnected(context.agentId);
      this.markActivity(context.agentId, 'idle');
      this.logger.log(`Agent connected: ${context.agentId}`);
    } catch {
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: WebSocket) {
    const context = this.contexts.get(client);
    if (context) {
      this.markDisconnected(context.agentId);
    }
    this.logger.log(
      `Agent disconnected${context ? `: ${context.agentId}` : ''}`,
    );
  }

  /** Close any open agent WebSockets (e.g. after owner revokes the device). */
  kickAgent(agentId: string): void {
    if (!this.server?.clients) {
      return;
    }
    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      const context = this.contexts.get(client);
      if (context?.agentId === agentId) {
        try {
          client.close(1008, 'Agent revoked');
        } catch {
          /* ignore */
        }
        this.contexts.delete(client);
        this.logger.log(`Kicked WebSocket for revoked agent ${agentId}`);
      }
    }
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }
    this.markHeartbeat(context.agentId);
    this.markActivity(
      context.agentId,
      this.extractActivityState(data) ?? 'idle',
    );
    void this.agentAuth.touchLastSeen(context.agentId);
    this.logger.log(`Received ping from agent ${context.agentId}`);
    return { type: 'pong', timestamp: new Date().toISOString() };
  }

  @SubscribeMessage('hello')
  handleHello(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }
    const nodeId = data?.node_id ?? 'unknown';
    this.logger.log(
      `Agent hello from node: ${nodeId} (agent: ${context.agentId})`,
    );
    this.markHeartbeat(context.agentId);
    this.markActivity(
      context.agentId,
      this.extractActivityState(data) ?? 'idle',
    );
    void this.agentAuth.touchLastSeen(context.agentId);
    return {
      type: 'hello_ack',
      node_id: nodeId,
      message: 'Welcome to Fabrix Central',
      timestamp: new Date().toISOString(),
    };
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }
    this.markHeartbeat(context.agentId);
    this.markActivity(
      context.agentId,
      this.extractActivityState(data) ?? 'idle',
    );
    void this.agentAuth.touchLastSeen(context.agentId);
    return {
      type: 'heartbeat_ack',
      timestamp: new Date().toISOString(),
    };
  }

  getAgentRuntimeState(agentId: string): AgentRuntimeState {
    const connected = (this.socketCountByAgent.get(agentId) ?? 0) > 0;
    const lastHeartbeatAt = this.lastHeartbeatByAgent.get(agentId) ?? null;
    if (!connected) {
      return {
        connected: false,
        activityState: 'offline',
        lastHeartbeatAt,
      };
    }
    return {
      connected: true,
      activityState: this.activityByAgent.get(agentId) ?? 'idle',
      lastHeartbeatAt,
    };
  }

  /**
   * Send a message to a specific connected agent
   */
  sendToAgent(agentId: string, message: any): boolean {
    if (!this.server?.clients) {
      return false;
    }

    let sent = false;
    const messageStr = JSON.stringify(message);

    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      const context = this.contexts.get(client);
      if (context?.agentId === agentId) {
        try {
          client.send(messageStr);
          sent = true;
          this.logger.log(
            `Sent message to agent ${agentId}: ${message.type || 'unknown'}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to send message to agent ${agentId}:`,
            error,
          );
        }
      }
    }

    return sent;
  }

  /**
   * Assign a job to an agent
   */
  assignJobToAgent(agentId: string, job: any): boolean {
    return this.sendToAgent(agentId, {
      type: 'job_assigned',
      job,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Notify agent about job status update
   */
  notifyJobStatusUpdate(
    agentId: string,
    jobId: string,
    status: string,
    metadata?: any,
  ): boolean {
    return this.sendToAgent(agentId, {
      type: 'job_status_update',
      job_id: jobId,
      status,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get all currently connected agent IDs
   */
  getConnectedAgentIds(): string[] {
    if (!this.server?.clients) {
      return [];
    }

    const agentIds = new Set<string>();
    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      const context = this.contexts.get(client);
      if (context?.agentId) {
        agentIds.add(context.agentId);
      }
    }

    return Array.from(agentIds);
  }

  /**
   * Message handler for job acceptance from agent
   */
  @SubscribeMessage('job_accept')
  async handleJobAccept(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const jobId = data?.job_id;
    if (!jobId) {
      return { type: 'error', message: 'Missing job_id' };
    }

    // Update job status to printing in database
    try {
      await this.db.db
        .update(jobs)
        .set({
          status: 'printing',
          updatedAt: new Date(),
          startedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      this.logger.log(`Job ${jobId} status updated to printing`);
    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} status:`, error);
      return { type: 'error', message: 'Failed to update job status' };
    }

    this.logger.log(`Agent ${context.agentId} accepted job ${jobId}`);
    this.markActivity(context.agentId, 'working');

    return {
      type: 'job_accept_ack',
      job_id: jobId,
      message: 'Job accepted successfully',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Message handler for job completion from agent
   */
  @SubscribeMessage('job_complete')
  async handleJobComplete(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const jobId = data?.job_id;
    const status = data?.status || 'completed';
    const result = data?.result || {};

    if (!jobId) {
      return { type: 'error', message: 'Missing job_id' };
    }

    // Update job status in database
    try {
      await this.db.db
        .update(jobs)
        .set({
          status,
          updatedAt: new Date(),
          completedAt: ['completed', 'failed', 'cancelled'].includes(status)
            ? new Date()
            : undefined,
        })
        .where(eq(jobs.id, jobId));
      this.logger.log(`Job ${jobId} status updated to ${status}`);
    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} status:`, error);
      return { type: 'error', message: 'Failed to update job status' };
    }

    this.logger.log(
      `Agent ${context.agentId} completed job ${jobId} with status ${status}`,
    );
    this.markActivity(context.agentId, 'idle');

    return {
      type: 'job_complete_ack',
      job_id: jobId,
      status,
      message: 'Job completion recorded',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Message handler for job progress updates from agent
   */
  @SubscribeMessage('job_progress')
  async handleJobProgress(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const jobId = data?.job_id;
    const progress = data?.progress;
    const message = data?.message;

    if (!jobId || progress === undefined) {
      return { type: 'error', message: 'Missing job_id or progress' };
    }

    // Update job progress in metadata
    try {
      const currentJob = await this.db.db
        .select({ metadata: jobs.metadata })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (currentJob[0]) {
        const metadata = currentJob[0].metadata || {};
        const updatedMetadata = {
          ...metadata,
          progress,
          progress_updated_at: new Date().toISOString(),
          last_progress_message: message,
        };

        await this.db.db
          .update(jobs)
          .set({
            metadata: updatedMetadata,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId));
      }
    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} progress:`, error);
      // Don't fail the request, just log error
    }

    this.logger.log(
      `Agent ${context.agentId} job ${jobId} progress: ${progress}%`,
    );

    return {
      type: 'job_progress_ack',
      job_id: jobId,
      progress,
      timestamp: new Date().toISOString(),
    };
  }

  private markConnected(agentId: string): void {
    this.socketCountByAgent.set(
      agentId,
      (this.socketCountByAgent.get(agentId) ?? 0) + 1,
    );
  }

  private markDisconnected(agentId: string): void {
    const next = (this.socketCountByAgent.get(agentId) ?? 0) - 1;
    if (next <= 0) {
      this.socketCountByAgent.delete(agentId);
      this.activityByAgent.delete(agentId);
      return;
    }
    this.socketCountByAgent.set(agentId, next);
  }

  private markHeartbeat(agentId: string): void {
    this.lastHeartbeatByAgent.set(agentId, new Date());
  }

  private markActivity(agentId: string, state: AgentActivityState): void {
    this.activityByAgent.set(agentId, state);
  }

  private extractActivityState(data: any): AgentActivityState | null {
    const raw = String(data?.activity_state ?? data?.state ?? '').toLowerCase();
    if (raw === 'working') {
      return 'working';
    }
    if (raw === 'idle') {
      return 'idle';
    }
    return null;
  }

  private extractBearerToken(request: IncomingMessage): string | undefined {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return undefined;
    }
    return auth.slice('Bearer '.length).trim() || undefined;
  }
}
