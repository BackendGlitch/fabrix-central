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
import { eq } from 'drizzle-orm';
import { users } from '../database/schema';

interface CustomerConnectionContext {
  customerId: string;
  email: string;
  name: string;
  lastSequence: number; // For reconnect-safe delivery
}

/**
 * CS-09: Frontend WebSocket Gateway for real-time customer job updates
 * Path: /ws/frontend
 * Auth: JWT Bearer token
 * Maps sockets to customer user IDs
 * Broadcasts job updates (progress, completion, failure) to owning customers
 */
@WebSocketGateway({ path: '/ws/frontend' })
export class FrontendGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(FrontendGateway.name);
  private readonly contexts = new WeakMap<WebSocket, CustomerConnectionContext>();
  private readonly customerConnections = new Map<string, WebSocket[]>(); // customerId -> array of connections
  private messageSequence = 0; // Global sequence counter for reconnect-safe delivery

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit() {
    this.logger.log('FrontendGateway initialized at /ws/frontend');
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const token = this.extractBearerToken(request);
    if (!token) {
      this.logger.warn('Frontend WebSocket rejected: No token provided');
      client.close(1008, 'Unauthorized');
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      // Verify user exists and is a customer
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
          `Frontend WebSocket rejected: User not found (${payload.sub})`,
        );
        client.close(1008, 'User not found');
        return;
      }

      if (!user.isActive) {
        this.logger.warn(
          `Frontend WebSocket rejected: Account deactivated (${user.email})`,
        );
        client.close(1008, 'Account deactivated');
        return;
      }

      if (user.role !== 'CUSTOMER') {
        this.logger.warn(
          `Frontend WebSocket rejected: User is not a customer (${user.email}, role: ${user.role})`,
        );
        client.close(1008, 'User is not a customer');
        return;
      }

      const context: CustomerConnectionContext = {
        customerId: user.id,
        email: user.email,
        name: user.name,
        lastSequence: 0,
      };

      this.contexts.set(client, context);
      this.addConnectionToCustomer(user.id, client);

      this.logger.log(`Customer connected: ${user.email} (ID: ${user.id})`);

      // Send welcome message
      client.send(
        JSON.stringify({
          type: 'connected',
          customerId: user.id,
          sequence: ++this.messageSequence,
          timestamp: new Date().toISOString(),
          message: 'Connected to job updates',
        }),
      );
    } catch (error) {
      this.logger.error('Frontend connection authentication failed:', error);
      client.close(1008, 'Authentication failed');
    }
  }

  handleDisconnect(client: WebSocket) {
    const context = this.contexts.get(client);
    if (context) {
      this.removeConnectionFromCustomer(context.customerId, client);
      this.contexts.delete(client);
      this.logger.log(`Customer disconnected: ${context.email}`);
    }
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any, @ConnectedSocket() client: WebSocket) {
    const context = this.contexts.get(client);
    if (!context) {
      return { type: 'error', message: 'Unauthorized' };
    }

    return {
      type: 'pong',
      sequence: ++this.messageSequence,
      timestamp: new Date().toISOString(),
    };
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

    this.logger.log(
      `Customer ${context.email} subscribed to job updates (lastSequence: ${data?.lastSequence || 0})`,
    );

    // Store client's last known sequence for reconnect scenarios
    if (data?.lastSequence) {
      context.lastSequence = data.lastSequence;
    }

    return {
      type: 'subscribed',
      sequence: ++this.messageSequence,
      timestamp: new Date().toISOString(),
      message: 'Subscribed to job updates',
    };
  }

  /**
   * CS-09: Broadcast job progress update to customer
   * Includes sequence number for reconnect-safe delivery
   */
  broadcastJobUpdate(
    customerId: string,
    jobId: string,
    updateData: {
      type: 'progress' | 'completed' | 'failed';
      status: string;
      progress?: number;
      currentLayer?: number;
      totalLayers?: number;
      etaMinutes?: number;
      errorMessage?: string;
      message?: string;
      timestamp: string;
    },
  ): boolean {
    const connections = this.customerConnections.get(customerId);
    if (!connections || connections.length === 0) {
      this.logger.debug(`No active connections for customer ${customerId}`);
      return false;
    }

    const sequence = ++this.messageSequence;
    const message = {
      type: 'job_update',
      jobId,
      updateType: updateData.type,
      status: updateData.status,
      progress: updateData.progress ?? null,
      currentLayer: updateData.currentLayer ?? null,
      totalLayers: updateData.totalLayers ?? null,
      etaMinutes: updateData.etaMinutes ?? null,
      errorMessage: updateData.errorMessage ?? null,
      message: updateData.message,
      sequence, // Reconnect-safe: client stores this and can request missed messages
      timestamp: updateData.timestamp,
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const client of connections) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          this.logger.debug(
            `Failed to send job update to customer ${customerId}:`,
            error,
          );
        }
      }
    }

    if (sentCount > 0) {
      this.logger.log(
        `Broadcast job ${updateData.type} to customer ${customerId} (seq: ${sequence}, sent to ${sentCount} connection${sentCount === 1 ? '' : 's'})`,
      );
    }

    return sentCount > 0;
  }

  /**
   * Notify customer of job approval/rejection
   */
  broadcastJobStatusChange(
    customerId: string,
    jobId: string,
    newStatus: string,
    message: string,
  ): boolean {
    const connections = this.customerConnections.get(customerId);
    if (!connections || connections.length === 0) {
      return false;
    }

    const sequence = ++this.messageSequence;
    const payload = {
      type: 'job_status_changed',
      jobId,
      newStatus,
      message,
      sequence,
      timestamp: new Date().toISOString(),
    };

    const messageStr = JSON.stringify(payload);
    let sentCount = 0;

    for (const client of connections) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          this.logger.debug(
            `Failed to send status change to customer ${customerId}:`,
            error,
          );
        }
      }
    }

    return sentCount > 0;
  }

  /**
   * Internal helper: Get total active connections
   */
  private getTotalConnections(): number {
    let total = 0;
    for (const connections of this.customerConnections.values()) {
      total += connections.length;
    }
    return total;
  }

  /**
   * Internal helper: Add socket connection to customer
   */
  private addConnectionToCustomer(customerId: string, client: WebSocket): void {
    const existing = this.customerConnections.get(customerId) || [];
    existing.push(client);
    this.customerConnections.set(customerId, existing);
    this.logger.debug(
      `Total active frontend connections: ${this.getTotalConnections()}`,
    );
  }

  /**
   * Internal helper: Remove socket connection from customer
   */
  private removeConnectionFromCustomer(
    customerId: string,
    client: WebSocket,
  ): void {
    const connections = this.customerConnections.get(customerId);
    if (!connections) return;

    const filtered = connections.filter((c) => c !== client);
    if (filtered.length === 0) {
      this.customerConnections.delete(customerId);
    } else {
      this.customerConnections.set(customerId, filtered);
    }
  }

  /**
   * Internal helper: Extract JWT from request headers
   */
  private extractBearerToken(request: IncomingMessage): string | null {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return null;
    }
    return auth.slice(7);
  }
}
