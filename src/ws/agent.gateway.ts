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
import { Logger, OnModuleInit, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AgentsService } from '../agents/agents.service';

interface ClientData {
  nodeId?: string;
  agentId?: string;
  ownerId?: string;
}

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(AgentGateway.name);
  private clientMetadata = new Map<WebSocket, ClientData>();
  private jwtSecret: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(AgentsService) private readonly agentsService: AgentsService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'default-secret';
  }

  onModuleInit() {
    this.logger.log('AgentGateway initialized');
  }

  handleConnection(client: WebSocket) {
    this.logger.log('Agent connected');
    const metadata: ClientData = {};
    
    // Extract JWT from headers
    try {
      // In ws library, headers are accessible via the request object
      // The WebSocket client might have request context
      const searchParams = new URL(`http://localhost${(client as any).url || '/'}`).searchParams;
      let token = searchParams.get('token');
      
      // Or try to extract from connection headers if available
      if (!token && (client as any).headers?.authorization) {
        const authHeader = (client as any).headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.slice(7);
        }
      }
      
      if (token) {
        try {
          const decoded = this.jwtService.verify(token);
          metadata.ownerId = decoded.sub; // JWT subject is the user ID
          this.logger.log(`[CONNECTION] Agent verified for owner: ${metadata.ownerId}`);
        } catch (err) {
          this.logger.warn(`[CONNECTION] JWT verification failed: ${err}`);
        }
      } else {
        this.logger.log('[CONNECTION] No JWT token in connection headers');
      }
    } catch (err) {
      this.logger.debug(`[CONNECTION] Error extracting JWT: ${err}`);
    }
    
    this.clientMetadata.set(client, metadata);
    
    // Attach message listener to this specific client
    client.on('message', async (data: any) => {
      try {
        // Convert buffer to string if needed
        let messageStr = typeof data === 'string' ? data : data.toString();
        const message = JSON.parse(messageStr);
        const messageType = message?.type;
        
        this.logger.debug(`[RAW MSG] Received message type: ${messageType}`);
        
        // Route based on message type
        if (messageType === 'hello') {
          await this.handleHello(message, client);
        } else if (messageType === 'heartbeat') {
          await this.handleHeartbeat(message, client);
        } else if (messageType === 'ping') {
          await this.handlePing(message, client);
        } else if (messageType === 'status_update') {
          await this.handleStatusUpdate(message, client);
        } else {
          this.logger.debug(`Unknown message type: ${messageType}`);
        }
      } catch (err) {
        this.logger.error(`Error handling raw message: ${err}`);
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    const metadata = this.clientMetadata.get(client);
    if (metadata?.agentId) {
      this.logger.log(`Agent disconnected: ${metadata.nodeId}`);
      // Update agent status to offline
      this.agentsService
        .updateAgentStatus(metadata.agentId, 'offline')
        .catch((err) => this.logger.error('Failed to set agent offline:', err));
      
      // Broadcast status update to all clients
      this.broadcastAgentStatusUpdate({
        agentId: metadata.agentId,
        nodeId: metadata.nodeId || 'unknown',
        status: 'offline',
        ownerId: metadata.ownerId,
      });
    }
    this.clientMetadata.delete(client);
  }

  @SubscribeMessage('ping')
  async handlePing(data: any, client: WebSocket) {
    const metadata = this.clientMetadata.get(client);
    this.logger.log(`[PING] Received ping from agent. Metadata: ${JSON.stringify(metadata)}`);
    
    // Update agent status to online when we receive a heartbeat
    if (metadata?.agentId) {
      try {
        await this.agentsService.updateAgentStatus(metadata.agentId, 'online', new Date());
        this.logger.log(`[PING] Agent ${metadata.nodeId} (${metadata.agentId}) marked as online`);
      } catch (err) {
        this.logger.error(`[PING] Failed to update agent status on ping: ${err}`);
      }
    } else {
      this.logger.warn(`[PING] No agentId in metadata, cannot update status`);
    }
    
    return { type: 'pong', timestamp: new Date().toISOString() };
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(data: any, client: WebSocket) {
    const metadata = this.clientMetadata.get(client);
    this.logger.log(`[HEARTBEAT] Received heartbeat from agent ${data?.node_id}. Metadata: ${JSON.stringify(metadata)}`);
    
    // Update agent status to online when we receive a heartbeat
    if (metadata?.agentId) {
      try {
        await this.agentsService.updateAgentStatus(metadata.agentId, 'online', new Date());
        this.logger.log(`[HEARTBEAT] Agent ${metadata.nodeId} (${metadata.agentId}) marked as online`);
      } catch (err) {
        this.logger.error(`[HEARTBEAT] Failed to update agent status: ${err}`);
      }
    } else {
      this.logger.warn(`[HEARTBEAT] No agentId in metadata for node ${data?.node_id}, cannot update status`);
    }
    
    return { type: 'heartbeat_ack', timestamp: new Date().toISOString() };
  }

  @SubscribeMessage('hello')
  async handleHello(data: any, client: WebSocket) {
    const nodeId = data?.node_id ?? 'unknown';
    const model = data?.model;
    let ownerId = this.clientMetadata.get(client)?.ownerId;

    // Extract owner_id from JWT token in hello message (decode without verification)
    if (!ownerId && data?.access_token) {
      try {
        const decoded = this.jwtService.decode(data.access_token) as any;
        if (decoded?.ownerId) {
          ownerId = decoded.ownerId;
          this.logger.log(`[HELLO] Extracted owner from JWT: ${ownerId}`);
          const metadata = this.clientMetadata.get(client) || {};
          metadata.ownerId = ownerId;
          this.clientMetadata.set(client, metadata);
        }
      } catch (err) {
        this.logger.warn(`[HELLO] Failed to decode JWT: ${err}`);
      }
    }

    this.logger.log(
      `[HELLO] Agent hello from node: ${nodeId}${ownerId ? ` (owner: ${ownerId})` : ' (NO OWNER)'}`
    );

    let agentId = nodeId;
    const metadata = this.clientMetadata.get(client) || {};

    // If we have owner info, create/update agent record
    if (ownerId && nodeId) {
      try {
        const existingAgent = await this.agentsService.getAgentByNodeId(nodeId);
        if (existingAgent) {
          // Check if the agent belongs to the same owner
          if (existingAgent.ownerId !== ownerId) {
            this.logger.warn(
              `[HELLO] Agent ${nodeId} exists but owned by ${existingAgent.ownerId}, not ${ownerId}. Revoking old agent and creating new one.`
            );
            // Revoke the old agent (don't delete, keep audit trail)
            try {
              await this.agentsService.revokeAgent(existingAgent.id, existingAgent.ownerId);
            } catch (revokeErr) {
              this.logger.warn(`[HELLO] Could not revoke old agent: ${revokeErr}`);
            }
            // Create new agent for current owner
            const newAgent = await this.agentsService.createAgent(
              ownerId,
              nodeId,
              model,
              model || nodeId,
            );
            agentId = newAgent.id;
            metadata.agentId = newAgent.id;
            metadata.ownerId = ownerId;
            metadata.nodeId = nodeId;
            this.logger.log(`[HELLO] Created new agent ${nodeId} with ID ${agentId} for owner ${ownerId}`);
          } else {
            // Same owner - just update status
            agentId = existingAgent.id;
            metadata.agentId = existingAgent.id;
            metadata.ownerId = existingAgent.ownerId;
            metadata.nodeId = nodeId;
            
            this.logger.log(`[HELLO] Found existing agent ${nodeId} with ID ${agentId}`);
            // Update agent to online status
            await this.agentsService.updateAgentStatus(agentId, 'online', new Date());
            this.logger.log(`[HELLO] Updated agent ${nodeId} status to online`);
          }
        } else {
          // Create new agent record
          const newAgent = await this.agentsService.createAgent(
            ownerId,
            nodeId,
            model,
            model || nodeId,
          );
          agentId = newAgent.id;
          metadata.agentId = newAgent.id;
          metadata.ownerId = ownerId;
          metadata.nodeId = nodeId;
          this.logger.log(`[HELLO] Created new agent ${nodeId} with ID ${agentId}`);
        }

        // Broadcast status update
        this.broadcastAgentStatusUpdate({
          agentId,
          nodeId,
          status: 'online',
          ownerId: metadata.ownerId,
          model,
        });
      } catch (err) {
        this.logger.error(`[HELLO] Failed to handle agent hello: ${err}`);
      }
    } else {
      this.logger.warn(`[HELLO] No owner_id or nodeId. Cannot register agent.`);
    }

    this.clientMetadata.set(client, metadata);

    return {
      type: 'hello_ack',
      node_id: nodeId,
      agent_id: agentId,
      message: 'Welcome to Fabrix Central',
      timestamp: new Date().toISOString(),
    };
  }

  @SubscribeMessage('status_update')
  async handleStatusUpdate(data: any, client: WebSocket) {
    const metadata = this.clientMetadata.get(client);
    if (!metadata?.agentId) {
      return { success: false, error: 'Agent not registered' };
    }

    const status = data?.status || 'online';
    try {
      await this.agentsService.updateAgentStatus(
        metadata.agentId,
        status,
        new Date(),
      );
      
      this.broadcastAgentStatusUpdate({
        agentId: metadata.agentId,
        nodeId: metadata.nodeId || 'unknown',
        status,
        ownerId: metadata.ownerId,
      });

      return { success: true };
    } catch (err) {
      this.logger.error('Failed to update agent status:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  private broadcastAgentStatusUpdate(data: {
    agentId: string;
    nodeId: string;
    status: string;
    ownerId?: string;
    model?: string;
  }) {
    const message = JSON.stringify({
      type: 'agent_status_update',
      agentId: data.agentId,
      nodeId: data.nodeId,
      status: data.status,
      ownerId: data.ownerId,
      model: data.model,
      timestamp: new Date().toISOString(),
    });

    // Broadcast to all connected clients
    this.server.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  }
}
