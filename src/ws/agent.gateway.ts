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

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly contexts = new WeakMap<WebSocket, { agentId: string; ownerId: string }>();

  @WebSocketServer()
  server: Server;

  constructor(private readonly agentAuth: AgentAuthService) {}

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
      this.logger.log(`Agent connected: ${context.agentId}`);
    } catch {
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: WebSocket) {
    const context = this.contexts.get(client);
    this.logger.log(`Agent disconnected${context ? `: ${context.agentId}` : ''}`);
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
    this.logger.log(`Agent hello from node: ${nodeId} (agent: ${context.agentId})`);
    void this.agentAuth.touchLastSeen(context.agentId);
    return {
      type: 'hello_ack',
      node_id: nodeId,
      message: 'Welcome to Fabrix Central',
      timestamp: new Date().toISOString(),
    };
  }

  private extractBearerToken(request: IncomingMessage): string | undefined {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return undefined;
    }
    return auth.slice('Bearer '.length).trim() || undefined;
  }
}
