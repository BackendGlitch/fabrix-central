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
import { CommandsService, CommandType } from '../agent/commands.service';
import { OwnerGateway } from './owner.gateway';
import { FrontendGateway } from './frontend.gateway';

import { eq } from 'drizzle-orm';
import { jobs, agents, jobEvents } from '../database/schema';

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
  server: any;

  constructor(
    private readonly agentAuth: AgentAuthService,
    private readonly db: DatabaseService,
    private readonly commands: CommandsService,
    private readonly ownerGateway: OwnerGateway,
    private readonly frontendGateway: FrontendGateway,
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

      // Set up message listener for raw WebSocket messages
      client.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          void this.handleMessage(client, message);
        } catch (error) {
          this.logger.error(
            `Failed to parse WebSocket message from ${context.agentId}: ${error}`,
          );
        }
      });
    } catch {
      client.close(1008, 'Unauthorized');
    }
  }

  /**
   * Dispatch incoming WebSocket messages to appropriate handlers
   */
  private async handleMessage(client: WebSocket, message: any) {
    const messageType = message.type;
    if (!messageType) {
      this.logger.warn('Received message without type field');
      return;
    }

    this.logger.debug(`Received message type: ${messageType}`);

    let response: any;

    // Dispatch to appropriate handler
    try {
      switch (messageType) {
        case 'ping':
          response = this.handlePing(message, client);
          break;
        case 'hello':
          response = this.handleHello(message, client);
          break;
        case 'heartbeat':
          response = this.handleHeartbeat(message, client);
          break;
        case 'command_ack':
          response = await this.handleCommandAck(message, client);
          break;
        case 'command_error':
          response = await this.handleCommandError(message, client);
          break;
        case 'job_accept':
          response = await this.handleJobAccept(message, client);
          break;
        case 'job_complete':
          response = await this.handleJobComplete(message, client);
          break;
        case 'job_progress':
          response = await this.handleJobProgress(message, client);
          break;
        case 'job_done':
          response = await this.handleJobDone(message, client);
          break;
        case 'job_failed':
          response = await this.handleJobFailed(message, client);
          break;
        default:
          this.logger.warn(`Unknown message type: ${messageType}`);
          return;
      }

      // Send response back to client if handler returned one
      if (response) {
        try {
          client.send(JSON.stringify(response));
        } catch (error) {
          this.logger.error(`Failed to send response: ${error}`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error handling message type ${messageType}: ${error}`,
      );
      try {
        client.send(
          JSON.stringify({
            type: 'error',
            message: `Internal error processing ${messageType}`,
          }),
        );
      } catch {
        /* ignore send errors */
      }
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
    void this.agentAuth.touchLastSeen(context.agentId).catch(err => 
      this.logger.error(`Failed to touch last seen for ping: ${err}`)
    );
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
    void this.agentAuth.touchLastSeen(context.agentId).catch(err => 
      this.logger.error(`Failed to touch last seen for hello: ${err}`)
    );
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
    void this.agentAuth.touchLastSeen(context.agentId).catch(err => 
      this.logger.error(`Failed to touch last seen for heartbeat: ${err}`)
    );
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
   * Send a command to an agent with correlation ID tracking
   */
  async sendCommand(
    agentId: string,
    jobId: string,
    commandType: CommandType,
    payload?: Record<string, unknown>,
  ): Promise<{ correlationId: string; sent: boolean }> {
    // Create command record in database
    const commandRecord = await this.commands.sendCommand({
      agentId,
      jobId,
      commandType,
      payload,
    });

    // Send message to agent
    const sent = this.sendToAgent(agentId, {
      type: 'command',
      correlationId: commandRecord.correlationId,
      commandType,
      jobId,
      payload,
      timestamp: new Date().toISOString(),
    });

    if (!sent) {
      this.logger.warn(
        `[COMMAND SEND FAILED] correlationId=${commandRecord.correlationId} agentId=${agentId} - agent not connected`,
      );
    }

    return {
      correlationId: commandRecord.correlationId,
      sent,
    };
  }

  /**
   * Handle command acknowledgment from agent
   */
  @SubscribeMessage('command_ack')
  async handleCommandAck(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      this.logger.warn('Received command_ack from unauthorized client');
      return { type: 'error', message: 'Unauthorized' };
    }

    const { correlationId } = data;
    if (!correlationId) {
      this.logger.warn(
        `[COMMAND ACK INVALID] agentId=${context.agentId} - no correlationId provided`,
      );
      return { type: 'error', message: 'correlationId is required' };
    }

    try {
      const command = await this.commands.acknowledgeCommand(correlationId);
      this.logger.log(
        `[COMMAND ACK SUCCESS] correlationId=${correlationId} agentId=${context.agentId} jobId=${command.jobId}`,
      );
      return {
        type: 'command_ack_received',
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `[COMMAND ACK FAILED] correlationId=${correlationId} - ${error}`,
      );
      return { type: 'error', message: `Failed to acknowledge command: ${error}` };
    }
  }

  /**
   * Handle command failure notification from agent
   */
  @SubscribeMessage('command_error')
  async handleCommandError(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const { correlationId, errorMessage } = data;
    if (!correlationId) {
      return { type: 'error', message: 'correlationId is required' };
    }

    try {
      const command = await this.commands.failCommand(
        correlationId,
        errorMessage || 'Unknown error',
      );
      this.logger.error(
        `[COMMAND ERROR RECORDED] correlationId=${correlationId} agentId=${context.agentId} error="${errorMessage}"`,
      );
      return {
        type: 'command_error_received',
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `[COMMAND ERROR TRACKING FAILED] correlationId=${correlationId} - ${error}`,
      );
      return { type: 'error', message: `Failed to record command error: ${error}` };
    }
  }
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
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };
      
      // Only set completedAt if job is in a final state
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        updateData.completedAt = new Date();
      }

      await this.db.db
        .update(jobs)
        .set(updateData)
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
    const progressMessage = data?.message;
    const currentLayer = data?.current_layer;
    const totalLayers = data?.total_layers;
    const etaMinutes = data?.eta_minutes;
    const monoTimestamp = data?.monotonic_timestamp;

    if (!jobId || progress === undefined) {
      return { type: 'error', message: 'Missing job_id or progress' };
    }

    // Update job progress in metadata with structured data (AG-11)
    try {
      const currentJob = await this.db.db
        .select({ metadata: jobs.metadata, customerId: jobs.customerId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!currentJob[0]) {
        this.logger.warn(`Job ${jobId} not found for progress update`);
        return { type: 'error', message: `Job ${jobId} not found` };
      }

      const metadata = currentJob[0].metadata || {};
      const updatedMetadata: any = {
        ...metadata,
        progress,
        progress_updated_at: new Date().toISOString(),
        current_layer: currentLayer ?? 0,
        total_layers: totalLayers ?? 0,
        eta_minutes: etaMinutes ?? 0,
        monotonic_timestamp: monoTimestamp ?? 0,
      };
      
      // Only include message if provided
      if (progressMessage) {
        updatedMetadata.last_progress_message = progressMessage;
      }

      await this.db.db
        .update(jobs)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      // CS-11: Persist progress event to job_events table
      try {
        await this.db.db.insert(jobEvents).values({
          jobId,
          type: 'progress',
          data: {
            progress,
            currentLayer: currentLayer ?? 0,
            totalLayers: totalLayers ?? 0,
            etaMinutes: etaMinutes ?? 0,
            message: progressMessage,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        this.logger.debug(`Failed to persist progress event: ${error}`);
      }

      // AG-11: Broadcast progress update to connected owner WebSockets
      try {
        const agent = await this.db.db
          .select({ ownerId: agents.ownerId })
          .from(jobs)
          .innerJoin(agents, eq(jobs.printerId, agents.id))
          .where(eq(jobs.id, jobId))
          .limit(1);
        
        if (agent && agent[0]) {
          this.ownerGateway.broadcastJobProgress(
            agent[0].ownerId,
            jobId,
            {
              progress,
              currentLayer: currentLayer ?? 0,
              totalLayers: totalLayers ?? 0,
              etaMinutes: etaMinutes ?? 0,
              message: progressMessage,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast progress to owner: ${error}`);
      }

      // CS-09: Broadcast progress update to owning customer via frontend gateway
      try {
        const customerJob = await this.db.db
          .select({ customerId: jobs.customerId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        
        if (customerJob && customerJob[0]) {
          this.frontendGateway.broadcastJobUpdate(
            customerJob[0].customerId,
            jobId,
            {
              type: 'progress',
              status: 'printing',
              progress,
              currentLayer: currentLayer ?? 0,
              totalLayers: totalLayers ?? 0,
              etaMinutes: etaMinutes ?? 0,
              message: progressMessage,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast progress to customer: ${error}`);
      }

    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} progress:`, error);
      return { type: 'error', message: 'Failed to update job progress' };
    }

    this.logger.log(
      `Agent ${context.agentId} job ${jobId} progress: ${progress}% (layer ${currentLayer}/${totalLayers})`,
    );

    return {
      type: 'job_progress_ack',
      job_id: jobId,
      progress,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * AG-11: Message handler for job done terminal event
   */
  @SubscribeMessage('job_done')
  async handleJobDone(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const jobId = data?.job_id;
    const totalTimeSeconds = data?.total_time_seconds ?? 0;

    if (!jobId) {
      return { type: 'error', message: 'Missing job_id' };
    }

    try {
      // Update job status to completed
      await this.db.db
        .update(jobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      // CS-11: Persist completion event to job_events table
      try {
        await this.db.db.insert(jobEvents).values({
          jobId,
          type: 'completed',
          data: {
            totalTimeSeconds,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        this.logger.debug(`Failed to persist completion event: ${error}`);
      }

      this.logger.log(`Job ${jobId} marked as completed (${totalTimeSeconds}s)`);

      // Broadcast completion to owner
      try {
        const agent = await this.db.db
          .select({ ownerId: agents.ownerId })
          .from(jobs)
          .innerJoin(agents, eq(jobs.printerId, agents.id))
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (agent && agent[0]) {
          this.ownerGateway.broadcastJobCompletion(agent[0].ownerId, jobId, 'completed');
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast job completion: ${error}`);
      }

      // CS-09: Broadcast completion to owning customer via frontend gateway
      try {
        const customerJob = await this.db.db
          .select({ customerId: jobs.customerId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        
        if (customerJob && customerJob[0]) {
          this.frontendGateway.broadcastJobUpdate(
            customerJob[0].customerId,
            jobId,
            {
              type: 'completed',
              status: 'completed',
              message: `Job completed successfully in ${totalTimeSeconds} seconds`,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast completion to customer: ${error}`);
      }

    } catch (error) {
      this.logger.error(`Failed to mark job ${jobId} as completed:`, error);
      return { type: 'error', message: 'Failed to update job completion' };
    }

    this.logger.log(`Agent ${context.agentId} completed job ${jobId}`);

    return {
      type: 'job_done_ack',
      job_id: jobId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * AG-11: Message handler for job failed terminal event
   */
  @SubscribeMessage('job_failed')
  async handleJobFailed(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    const jobId = data?.job_id;
    const errorMessage = data?.error_message || 'Unknown error';

    if (!jobId) {
      return { type: 'error', message: 'Missing job_id' };
    }

    try {
      // Update job status to failed and store error
      const updateData: any = {
        status: 'failed',
        completedAt: new Date(),
        updatedAt: new Date(),
      };

      const currentJob = await this.db.db
        .select({ metadata: jobs.metadata })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (currentJob[0]) {
        const metadata = currentJob[0].metadata || {};
        updateData.metadata = {
          ...metadata,
          error_message: errorMessage,
          failed_at: new Date().toISOString(),
        };
      }

      await this.db.db
        .update(jobs)
        .set(updateData)
        .where(eq(jobs.id, jobId));

      // CS-11: Persist failure event to job_events table
      try {
        await this.db.db.insert(jobEvents).values({
          jobId,
          type: 'failed',
          data: {
            errorMessage,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        this.logger.debug(`Failed to persist failure event: ${error}`);
      }

      this.logger.log(`Job ${jobId} marked as failed: ${errorMessage}`);

      // Broadcast failure to owner
      try {
        const agent = await this.db.db
          .select({ ownerId: agents.ownerId })
          .from(jobs)
          .innerJoin(agents, eq(jobs.printerId, agents.id))
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (agent && agent[0]) {
          this.ownerGateway.broadcastJobFailure(agent[0].ownerId, jobId, errorMessage);
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast job failure: ${error}`);
      }

      // CS-09: Broadcast failure to owning customer via frontend gateway
      try {
        const customerJob = await this.db.db
          .select({ customerId: jobs.customerId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        
        if (customerJob && customerJob[0]) {
          this.frontendGateway.broadcastJobUpdate(
            customerJob[0].customerId,
            jobId,
            {
              type: 'failed',
              status: 'failed',
              errorMessage,
              message: `Job failed: ${errorMessage}`,
              timestamp: new Date().toISOString(),
            }
          );
        }
      } catch (error) {
        this.logger.debug(`Failed to broadcast failure to customer: ${error}`);
      }

    } catch (error) {
      this.logger.error(`Failed to mark job ${jobId} as failed:`, error);
      return { type: 'error', message: 'Failed to update job failure status' };
    }

    this.logger.log(`Agent ${context.agentId} job ${jobId} failed: ${errorMessage}`);

    return {
      type: 'job_failed_ack',
      job_id: jobId,
      error_message: errorMessage,
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
