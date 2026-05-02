import { AgentGateway } from './agent.gateway';
import { AgentAuthService } from '../agent-auth/agent-auth.service';
import { DatabaseService } from '../database/database.service';
import { CommandsService } from '../agent/commands.service';
import { OwnerGateway } from './owner.gateway';
import { FrontendGateway } from './frontend.gateway';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

type MockDb = {
  db: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };
};

const makeSelectChain = (result: any[]) => {
  const chain: any = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue(result),
    orderBy: jest.fn().mockResolvedValue(result),
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  return chain;
};

const makeInsertChain = (returningResult: any[] = []): any => {
  const chain: any = {
    values: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
  };
  chain.values.mockReturnValue(chain);
  chain.returning?.mockReturnValue(chain);
  return chain;
};

const makeUpdateChain = (returningResult: any[] = []): any => {
  const chain: any = {
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning?.mockReturnValue(chain);
  return chain;
};

function makeMockWebSocket(): WebSocket {
  const ws = {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  } as unknown as WebSocket;
  return ws;
}

describe('AgentGateway', () => {
  let gateway: AgentGateway;
  let db: MockDb;
  let agentAuth: jest.Mocked<AgentAuthService>;
  let commands: jest.Mocked<CommandsService>;
  let ownerGateway: jest.Mocked<OwnerGateway>;
  let frontendGateway: jest.Mocked<FrontendGateway>;

  const agentContext = { agentId: 'agent-1', ownerId: 'owner-1' };

  beforeEach(() => {
    db = {
      db: {
        insert: jest.fn(),
        select: jest.fn(),
        update: jest.fn(),
      },
    };

    agentAuth = {
      verifyAccessToken: jest.fn(),
      isAgentActive: jest.fn(),
      touchLastSeen: jest.fn(),
    } as unknown as jest.Mocked<AgentAuthService>;

    commands = {
      sendCommand: jest.fn(),
      acknowledgeCommand: jest.fn(),
      failCommand: jest.fn(),
      timeoutCommand: jest.fn(),
      getCommandHistory: jest.fn(),
      getCommandByCorrelationId: jest.fn(),
      getPendingCommands: jest.fn(),
      checkAndHandleTimeouts: jest.fn(),
    } as unknown as jest.Mocked<CommandsService>;

    ownerGateway = {
      broadcastJobProgress: jest.fn(),
      broadcastJobCompletion: jest.fn(),
      broadcastJobFailure: jest.fn(),
      notifyNewPendingJobs: jest.fn(),
      notifyJobStatusUpdate: jest.fn(),
    } as unknown as jest.Mocked<OwnerGateway>;

    frontendGateway = {
      broadcastJobUpdate: jest.fn(),
      broadcastJobStatusChange: jest.fn(),
    } as unknown as jest.Mocked<FrontendGateway>;

    gateway = new AgentGateway(
      agentAuth,
      db as unknown as DatabaseService,
      commands as unknown as CommandsService,
      ownerGateway as unknown as OwnerGateway,
      frontendGateway as unknown as FrontendGateway,
    );

    // Stub the server and context map to avoid undefined errors
    (gateway as any).server = {
      clients: new Set(),
    };

    // Seed context for the test agent
    const client = makeMockWebSocket();
    (gateway as any).contexts.set(client, agentContext);
    (gateway as any).markConnected('agent-1');
  });

  describe('handleCommandAck', () => {
    it('verifies correlationId and acknowledges the command', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      commands.acknowledgeCommand.mockResolvedValue({
        id: 'cmd-1',
        correlationId: 'corr-123',
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'start',
        state: 'acked',
        payload: {},
        errorMessage: null,
        ackedAt: new Date(),
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await gateway.handleCommandAck(
        { correlationId: 'corr-123' },
        client,
      );

      expect(commands.acknowledgeCommand).toHaveBeenCalledWith('corr-123');
      expect(result).toEqual({
        type: 'command_ack_received',
        correlationId: 'corr-123',
        timestamp: expect.any(String),
      });
    });

    it('returns error when correlationId is missing', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const result = await gateway.handleCommandAck({}, client);

      expect(result).toEqual({
        type: 'error',
        message: 'correlationId is required',
      });
      expect(commands.acknowledgeCommand).not.toHaveBeenCalled();
    });

    it('returns error for unauthorized client', async () => {
      const client = makeMockWebSocket();
      // No context set → unauthorized

      const result = await gateway.handleCommandAck(
        { correlationId: 'corr-123' },
        client,
      );

      expect(result).toEqual({
        type: 'error',
        message: 'Unauthorized',
      });
    });
  });

  describe('handleCommandError', () => {
    it('verifies correlationId and fails the command', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      commands.failCommand.mockResolvedValue({
        id: 'cmd-1',
        correlationId: 'corr-123',
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'start',
        state: 'failed',
        payload: {},
        errorMessage: 'Agent error',
        ackedAt: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await gateway.handleCommandError(
        { correlationId: 'corr-123', errorMessage: 'Agent error' },
        client,
      );

      expect(commands.failCommand).toHaveBeenCalledWith(
        'corr-123',
        'Agent error',
      );
      expect(result).toEqual({
        type: 'command_error_received',
        correlationId: 'corr-123',
        timestamp: expect.any(String),
      });
    });

    it('returns error when correlationId is missing', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const result = await gateway.handleCommandError(
        { errorMessage: 'error' },
        client,
      );

      expect(result).toEqual({
        type: 'error',
        message: 'correlationId is required',
      });
    });

    it('uses default error message when not provided', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      commands.failCommand.mockResolvedValue({
        id: 'cmd-1',
        correlationId: 'corr-123',
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'start',
        state: 'failed',
        payload: {},
        errorMessage: 'Unknown error',
        ackedAt: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleCommandError({ correlationId: 'corr-123' }, client);

      expect(commands.failCommand).toHaveBeenCalledWith(
        'corr-123',
        'Unknown error',
      );
    });
  });

  describe('handleJobProgress', () => {
    it('updates job metadata with progress information', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      // Select current job
      const jobSelect = makeSelectChain([
        {
          metadata: { previous: 'data' },
          customerId: 'customer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(jobSelect);

      // Update job
      const updateChain = makeUpdateChain();
      db.db.update.mockReturnValueOnce(updateChain);

      // Insert job event
      const insertChain = makeInsertChain();
      db.db.insert.mockReturnValueOnce(insertChain);

      // Select agent (owner)
      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      // Select customer job
      const customerSelect = makeSelectChain([{ customerId: 'customer-1' }]);
      db.db.select.mockReturnValueOnce(customerSelect);

      const result = await gateway.handleJobProgress(
        {
          job_id: 'job-1',
          progress: 50,
          current_layer: 10,
          total_layers: 20,
          eta_minutes: 30,
        },
        client,
      );

      expect(result).toEqual({
        type: 'job_progress_ack',
        job_id: 'job-1',
        progress: 50,
        timestamp: expect.any(String),
      });

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            progress: 50,
            current_layer: 10,
            total_layers: 20,
            eta_minutes: 30,
          }),
        }),
      );

      expect(ownerGateway.broadcastJobProgress).toHaveBeenCalledWith(
        'owner-1',
        'job-1',
        expect.objectContaining({
          progress: 50,
          currentLayer: 10,
          totalLayers: 20,
          etaMinutes: 30,
        }),
      );

      expect(frontendGateway.broadcastJobUpdate).toHaveBeenCalledWith(
        'customer-1',
        'job-1',
        expect.objectContaining({
          type: 'progress',
          progress: 50,
          currentLayer: 10,
        }),
      );
    });

    it('returns error when job_id or progress is missing', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const resultNoJobId = await gateway.handleJobProgress(
        { progress: 50 },
        client,
      );

      expect(resultNoJobId).toEqual({
        type: 'error',
        message: 'Missing job_id or progress',
      });

      const resultNoProgress = await gateway.handleJobProgress(
        { job_id: 'job-1' },
        client,
      );

      expect(resultNoProgress).toEqual({
        type: 'error',
        message: 'Missing job_id or progress',
      });
    });

    it('returns error when job not found', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const jobSelect = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const result = await gateway.handleJobProgress(
        { job_id: 'non-existent', progress: 50 },
        client,
      );

      expect(result).toEqual({
        type: 'error',
        message: 'Job non-existent not found',
      });
    });
  });

  describe('handleJobDone', () => {
    it('updates job to completed and broadcasts', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      // Current job status for transition validation (printing → completed)
      const jobStatusSelect = makeSelectChain([{ status: 'printing' }]);
      db.db.select.mockReturnValueOnce(jobStatusSelect);

      // Update job
      const updateChain = makeUpdateChain();
      db.db.update.mockReturnValueOnce(updateChain);

      // Insert job event
      const insertChain = makeInsertChain();
      db.db.insert.mockReturnValueOnce(insertChain);

      // Select agent
      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      // Select customer job
      const customerSelect = makeSelectChain([{ customerId: 'customer-1' }]);
      db.db.select.mockReturnValueOnce(customerSelect);

      const result = await gateway.handleJobDone(
        { job_id: 'job-1', total_time_seconds: 120 },
        client,
      );

      expect(result).toEqual({
        type: 'job_done_ack',
        job_id: 'job-1',
        timestamp: expect.any(String),
      });

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        }),
      );

      expect(ownerGateway.broadcastJobCompletion).toHaveBeenCalledWith(
        'owner-1',
        'job-1',
        'completed',
      );

      expect(frontendGateway.broadcastJobUpdate).toHaveBeenCalledWith(
        'customer-1',
        'job-1',
        expect.objectContaining({
          type: 'completed',
          status: 'completed',
        }),
      );
    });

    it('returns error when job_id is missing', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const result = await gateway.handleJobDone({}, client);

      expect(result).toEqual({
        type: 'error',
        message: 'Missing job_id',
      });
    });
  });

  describe('handleJobFailed', () => {
    it('updates job to failed and broadcasts', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const jobStatusSelect = makeSelectChain([{ status: 'printing' }]);
      db.db.select.mockReturnValueOnce(jobStatusSelect);

      // Metadata for merge before update
      const jobSelect = makeSelectChain([{ metadata: { previous: 'data' } }]);
      db.db.select.mockReturnValueOnce(jobSelect);

      // Update job
      const updateChain = makeUpdateChain();
      db.db.update.mockReturnValueOnce(updateChain);

      // Insert job event
      const insertChain = makeInsertChain();
      db.db.insert.mockReturnValueOnce(insertChain);

      // Select agent
      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      // Select customer job
      const customerSelect = makeSelectChain([{ customerId: 'customer-1' }]);
      db.db.select.mockReturnValueOnce(customerSelect);

      const result = await gateway.handleJobFailed(
        { job_id: 'job-1', error_message: 'Print failed' },
        client,
      );

      expect(result).toEqual({
        type: 'job_failed_ack',
        job_id: 'job-1',
        error_message: 'Print failed',
        timestamp: expect.any(String),
      });

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );

      expect(ownerGateway.broadcastJobFailure).toHaveBeenCalledWith(
        'owner-1',
        'job-1',
        'Print failed',
      );

      expect(frontendGateway.broadcastJobUpdate).toHaveBeenCalledWith(
        'customer-1',
        'job-1',
        expect.objectContaining({
          type: 'failed',
          status: 'failed',
          errorMessage: 'Print failed',
        }),
      );
    });

    it('returns error when job_id is missing', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const result = await gateway.handleJobFailed({}, client);

      expect(result).toEqual({
        type: 'error',
        message: 'Missing job_id',
      });
    });

    it('uses default error message when not provided', async () => {
      const client = makeMockWebSocket();
      (gateway as any).contexts.set(client, agentContext);

      const jobStatusSelect = makeSelectChain([{ status: 'printing' }]);
      db.db.select.mockReturnValueOnce(jobStatusSelect);

      const jobSelect = makeSelectChain([{ metadata: {} }]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const updateChain = makeUpdateChain();
      db.db.update.mockReturnValueOnce(updateChain);

      const insertChain = makeInsertChain();
      db.db.insert.mockReturnValueOnce(insertChain);

      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      const customerSelect = makeSelectChain([{ customerId: 'customer-1' }]);
      db.db.select.mockReturnValueOnce(customerSelect);

      const result = await gateway.handleJobFailed({ job_id: 'job-1' }, client);

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );

      // The error_message stored in metadata should include "Unknown error"
      expect(updateChain.set.mock.calls[0][0].metadata).toEqual(
        expect.objectContaining({
          error_message: 'Unknown error',
        }),
      );

      expect(result.error_message).toBe('Unknown error');
    });
  });

  describe('assignJobToAgent', () => {
    it('sends job_assigned message via WebSocket', () => {
      const client = makeMockWebSocket();
      (gateway as any).server.clients.add(client);
      (gateway as any).contexts.set(client, agentContext);

      const jobData = { id: 'job-1', name: 'Test Job' };
      const result = gateway.assignJobToAgent('agent-1', jobData);

      expect(result).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('job_assigned'),
      );
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(jobData)),
      );
    });

    it('returns false when agent is not connected', () => {
      // No clients in server
      const jobData = { id: 'job-1', name: 'Test Job' };
      const result = gateway.assignJobToAgent('non-existent', jobData);

      expect(result).toBe(false);
    });
  });

  describe('sendCommand', () => {
    it('creates command record and sends to agent, returns correlationId', async () => {
      const client = makeMockWebSocket();
      (gateway as any).server.clients.add(client);
      (gateway as any).contexts.set(client, agentContext);

      commands.sendCommand.mockResolvedValue({
        id: 'cmd-1',
        correlationId: 'corr-abc',
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'pause',
        state: 'sent',
        payload: {},
        errorMessage: null,
        ackedAt: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await gateway.sendCommand('agent-1', 'job-1', 'pause', {
        reason: 'test',
      });

      expect(commands.sendCommand).toHaveBeenCalledWith({
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'pause',
        payload: { reason: 'test' },
      });

      expect(result).toEqual({
        correlationId: 'corr-abc',
        sent: true,
      });

      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('command'),
      );
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('corr-abc'),
      );
    });

    it('returns sent: false when agent is not connected', async () => {
      commands.sendCommand.mockResolvedValue({
        id: 'cmd-1',
        correlationId: 'corr-abc',
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'pause',
        state: 'sent',
        payload: {},
        errorMessage: null,
        ackedAt: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await gateway.sendCommand(
        'agent-not-connected',
        'job-1',
        'pause',
      );

      expect(result).toEqual({
        correlationId: 'corr-abc',
        sent: false,
      });
    });
  });
});
