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

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(AgentGateway.name);

  @WebSocketServer()
  server: Server;

  constructor() {}

  onModuleInit() {
    // Redis pub/sub disabled — will be re-enabled when Redis is configured
    this.logger.log('AgentGateway initialized (Redis pub/sub skipped)');
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
