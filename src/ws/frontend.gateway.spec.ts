import { FrontendGateway } from './frontend.gateway';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

type MockDb = {
  db: {
    select: jest.Mock;
  };
};

const makeSelectChain = (result: any[]) => {
  const chain: any = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue(result),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
};

function makeMockWebSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  } as unknown as WebSocket;
}

function makeMockRequest(authHeader?: string): IncomingMessage {
  return {
    headers: {
      authorization: authHeader,
    },
    url: '/ws/frontend',
  } as unknown as IncomingMessage;
}

describe('FrontendGateway', () => {
  let gateway: FrontendGateway;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let db: MockDb;

  const validCustomerUser = {
    id: 'customer-1',
    email: 'customer@example.com',
    name: 'Test Customer',
    role: 'CUSTOMER',
    isActive: true,
  };

  const validOwnerUser = {
    id: 'owner-1',
    email: 'owner@example.com',
    name: 'Test Owner',
    role: 'OWNER',
    isActive: true,
  };

  beforeEach(() => {
    db = {
      db: {
        select: jest.fn(),
      },
    };

    jwtService = {
      verify: jest.fn(),
      sign: jest.fn(),
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    configService.getOrThrow.mockReturnValue('test-secret');

    gateway = new FrontendGateway(
      jwtService,
      configService,
      db as unknown as DatabaseService,
    );
  });

  describe('handleConnection', () => {
    it('accepts connection with valid JWT for CUSTOMER role', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });

      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      await gateway.handleConnection(client, request);

      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('connected'),
      );
      expect(client.close).not.toHaveBeenCalled();
    });

    it('rejects connection when no token provided', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest(undefined);

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
      expect(client.send).not.toHaveBeenCalled();
    });

    it('rejects connection when auth header does not start with Bearer', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Basic some-token');

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
    });

    it('rejects connection with invalid JWT token', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer invalid-token');

      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'Authentication failed');
    });

    it('rejects connection when user not found in database', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'nonexistent' });

      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'User not found');
    });

    it('rejects connection when account is deactivated', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'deactivated-user' });

      const selectChain = makeSelectChain([
        { ...validCustomerUser, isActive: false },
      ]);
      db.db.select.mockReturnValueOnce(selectChain);

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'Account deactivated');
    });

    it('rejects connection with non-CUSTOMER role', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer owner-token');

      jwtService.verify.mockReturnValue({ sub: 'owner-1' });

      const selectChain = makeSelectChain([validOwnerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      await gateway.handleConnection(client, request);

      expect(client.close).toHaveBeenCalledWith(1008, 'User is not a customer');
    });
  });

  describe('handleDisconnect', () => {
    it('removes client from connections map on disconnect', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });
      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      // Connect first
      await gateway.handleConnection(client, request);

      // Now disconnect
      gateway.handleDisconnect(client);

      // Verify no connections remain for this customer
      const result = gateway.broadcastJobUpdate('customer-1', 'job-1', {
        type: 'progress',
        status: 'printing',
        timestamp: new Date().toISOString(),
      });

      expect(result).toBe(false);
    });
  });

  describe('handlePing', () => {
    it('returns pong for authenticated client', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });
      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      // Connect first to set context
      await gateway.handleConnection(client, request);

      const result = gateway.handlePing({}, client);

      expect(result).toEqual({
        type: 'pong',
        sequence: expect.any(Number),
        timestamp: expect.any(String),
      });
    });

    it('returns error for unauthenticated client', () => {
      const client = makeMockWebSocket();

      const result = gateway.handlePing({}, client);

      expect(result).toEqual({ type: 'error', message: 'Unauthorized' });
    });
  });

  describe('handleSubscribe', () => {
    it('stores lastSequence and confirms subscription', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });
      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      // Connect first
      await gateway.handleConnection(client, request);

      const result = gateway.handleSubscribe({ lastSequence: 42 }, client);

      expect(result).toEqual({
        type: 'subscribed',
        sequence: expect.any(Number),
        timestamp: expect.any(String),
        message: 'Subscribed to job updates',
      });
    });

    it('returns error for unauthenticated client', () => {
      const client = makeMockWebSocket();

      const result = gateway.handleSubscribe({}, client);

      expect(result).toEqual({ type: 'error', message: 'Unauthorized' });
    });
  });

  describe('broadcastJobUpdate', () => {
    it('sends update to all connected clients for that customer', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });
      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      // Connect to establish mapping
      await gateway.handleConnection(client, request);

      const result = gateway.broadcastJobUpdate('customer-1', 'job-1', {
        type: 'progress',
        status: 'printing',
        progress: 50,
        currentLayer: 10,
        totalLayers: 20,
        etaMinutes: 30,
        message: 'Printing in progress',
        timestamp: new Date().toISOString(),
      });

      expect(result).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('job_update'),
      );
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('job-1'),
      );
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('"progress":50'),
      );
    });

    it('returns false when customer has no active connections', () => {
      const result = gateway.broadcastJobUpdate('unknown-customer', 'job-1', {
        type: 'progress',
        status: 'printing',
        timestamp: new Date().toISOString(),
      });

      expect(result).toBe(false);
    });
  });

  describe('broadcastJobStatusChange', () => {
    it('sends status change to customer', async () => {
      const client = makeMockWebSocket();
      const request = makeMockRequest('Bearer valid-token');

      jwtService.verify.mockReturnValue({ sub: 'customer-1' });
      const selectChain = makeSelectChain([validCustomerUser]);
      db.db.select.mockReturnValueOnce(selectChain);

      // Connect to establish mapping
      await gateway.handleConnection(client, request);

      const result = gateway.broadcastJobStatusChange(
        'customer-1',
        'job-1',
        'cancelled',
        'Your job has been cancelled',
      );

      expect(result).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('job_status_changed'),
      );
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('"newStatus":"cancelled"'),
      );
    });

    it('returns false when customer has no active connections', () => {
      const result = gateway.broadcastJobStatusChange(
        'unknown-customer',
        'job-1',
        'cancelled',
        'Test message',
      );

      expect(result).toBe(false);
    });
  });
});
