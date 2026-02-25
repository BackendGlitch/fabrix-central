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
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(AgentGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.redisService.onMessage((_channel, message) => {
      try {
        const payload = JSON.parse(message);
        // broadcast incoming Redis messages to local WS clients
        const clients = (this.server as any)?.clients as Set<any> | undefined;
        if (clients) {
          clients.forEach((client) => {
            if (client && client.readyState === 1) {
              client.send(JSON.stringify(payload));
            }
          });
        }
      } catch (e) {
        this.logger.error('Error handling redis message', e as any);
      }
    });
  }

  handleConnection(client: WebSocket) {
    this.logger.log('Agent connected');
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Agent disconnected');
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    this.logger.log('Received ping from agent');
    return { type: 'pong', timestamp: new Date().toISOString() };
  }

  @SubscribeMessage('hello')
  handleHello(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    const nodeId = data?.node_id ?? 'unknown';
    this.logger.log(`Agent hello from node: ${nodeId}`);
    return {
      type: 'hello_ack',
      node_id: nodeId,
      message: 'Welcome to Fabrix Central',
      timestamp: new Date().toISOString(),
    };
  }
}
