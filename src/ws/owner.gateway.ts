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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import type { JobDetailDto } from '../customer/jobs/dto';
import { eq } from 'drizzle-orm';
import { users } from '../database/schema';

interface OwnerConnectionContext {
  ownerId: string;
  email: string;
  name: string;
}

@WebSocketGateway({ path: '/ws/owner' })
export class OwnerGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(OwnerGateway.name);
  private readonly contexts = new WeakMap<WebSocket, OwnerConnectionContext>();
  private readonly ownerConnections = new Map<string, WebSocket[]>(); // ownerId -> array of connections

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit() {
    this.logger.log('OwnerGateway initialized');
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const token = this.extractBearerToken(request);
    if (!token) {
      this.logger.warn('WebSocket connection rejected: No token provided');
      client.close(1008, 'Unauthorized');
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      // Verify user exists and is an owner
      const [user] = await this.db.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (!user) {
        this.logger.warn(
          `WebSocket connection rejected: User not found for token subject ${payload.sub}`,
        );
        client.close(1008, 'User not found');
        return;
      }

      if (!user.isActive) {
        this.logger.warn(
          `WebSocket connection rejected: Account deactivated for user ${user.email}`,
        );
        client.close(1008, 'Account deactivated');
        return;
      }

      if (user.role !== 'OWNER') {
        this.logger.warn(
          `WebSocket connection rejected: User ${user.email} is not an owner (role: ${user.role})`,
        );
        client.close(1008, 'User is not an owner');
        return;
      }

      const context: OwnerConnectionContext = {
        ownerId: user.id,
        email: user.email,
        name: user.name,
      };

      this.contexts.set(client, context);
      this.addConnectionToOwner(user.id, client);

      this.logger.log(`Owner connected: ${user.email} (ID: ${user.id})`);
      this.logger.debug(
        `Active owner connections: ${this.getTotalConnections()}`,
      );
    } catch (error) {
      this.logger.error('Connection authentication failed:', error);
      client.close(1008, 'Authentication failed');
    }
  }

  handleDisconnect(client: WebSocket) {
    const context = this.contexts.get(client);
    if (context) {
      this.removeConnectionFromOwner(context.ownerId, client);
      this.contexts.delete(client);
      this.logger.log(`Owner disconnected: ${context.email}`);
      this.logger.debug(
        `Active owner connections: ${this.getTotalConnections()}`,
      );
    }
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    return { type: 'pong', timestamp: new Date().toISOString() };
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: any,
    @ConnectedSocket() client: WebSocket,
  ) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    this.logger.log(`Owner ${context.email} subscribed to updates`);
    return {
      type: 'subscribed',
      timestamp: new Date().toISOString(),
      message: 'Subscribed to job updates',
    };
  }

  /**
   * Notify all connections for a specific owner about new pending jobs
   */
  notifyNewPendingJobs(
    ownerId: string,
    jobCount: number,
    job?: JobDetailDto,
  ): boolean {
    const connections = this.ownerConnections.get(ownerId);
    if (!connections || connections.length === 0) {
      this.logger.debug(`No active connections for owner ${ownerId}`);
      return false;
    }

    const message = {
      type: 'new_pending_jobs',
      jobCount,
      timestamp: new Date().toISOString(),
      message: `You have ${jobCount} new job${jobCount === 1 ? '' : 's'} pending approval`,
      job,
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const client of connections) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          this.logger.error(
            `Failed to send message to owner ${ownerId}:`,
            error,
          );
        }
      }
    }

    this.logger.log(
      `Notified owner ${ownerId} about ${jobCount} pending jobs (sent to ${sentCount} connection${sentCount === 1 ? '' : 's'})`,
    );
    return sentCount > 0;
  }

  /**
   * Notify all connections for a specific owner about job status update
   */
  notifyJobStatusUpdate(
    ownerId: string,
    jobId: string,
    status: string,
    action: string,
  ): boolean {
    const connections = this.ownerConnections.get(ownerId);
    if (!connections || connections.length === 0) {
      return false;
    }

    const message = {
      type: 'job_status_update',
      jobId,
      status,
      action,
      timestamp: new Date().toISOString(),
      message: `Job ${jobId} has been ${action} (status: ${status})`,
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const client of connections) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          this.logger.error(
            `Failed to send job update to owner ${ownerId}:`,
            error,
          );
        }
      }
    }

    this.logger.log(
      `Notified owner ${ownerId} about job ${jobId} ${action} (sent to ${sentCount} connection${sentCount === 1 ? '' : 's'})`,
    );
    return sentCount > 0;
  }

  /**
   * Get all connected owner IDs
   */
  getConnectedOwnerIds(): string[] {
    return Array.from(this.ownerConnections.keys());
  }

  /**
   * Check if an owner has active connections
   */
  isOwnerConnected(ownerId: string): boolean {
    const connections = this.ownerConnections.get(ownerId);
    return connections !== undefined && connections.length > 0;
  }

  /**
   * Get total number of active owner connections
   */
  getTotalConnections(): number {
    let total = 0;
    for (const connections of this.ownerConnections.values()) {
      total += connections.length;
    }
    return total;
  }

  private addConnectionToOwner(ownerId: string, client: WebSocket): void {
    const connections = this.ownerConnections.get(ownerId) || [];
    connections.push(client);
    this.ownerConnections.set(ownerId, connections);
  }

  private removeConnectionFromOwner(ownerId: string, client: WebSocket): void {
    const connections = this.ownerConnections.get(ownerId);
    if (!connections) {
      return;
    }

    const index = connections.indexOf(client);
    if (index !== -1) {
      connections.splice(index, 1);
    }

    if (connections.length === 0) {
      this.ownerConnections.delete(ownerId);
    } else {
      this.ownerConnections.set(ownerId, connections);
    }
  }

  private extractBearerToken(request: IncomingMessage): string | undefined {
    // Check Authorization header first
    const auth = request.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim() || undefined;
    }

    // Check query parameter (e.g., ws://...?token=...)
    if (request.url) {
      try {
        // Parse the URL - request.url is typically just the path and query string
        // e.g., "/ws/owner?token=xyz"
        const url = new URL(
          request.url,
          `http://${request.headers.host || 'localhost:4000'}`,
        );
        const token = url.searchParams.get('token');
        if (token) {
          const trimmedToken = token.trim();
          if (trimmedToken) {
            return trimmedToken;
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse WebSocket URL: ${request.url}`,
        );
      }
    }

    return undefined;
  }
}
