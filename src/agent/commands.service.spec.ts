import { CommandsService } from './commands.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

type MockDb = {
  db: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };
};

const makeSelectChain = (result: any[]) => {
  const promise = Promise.resolve(result);
  const chain: any = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue(result),
    orderBy: jest.fn(),
    then: promise.then.bind(promise),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
};

const makeInsertChain = (returningResult: any[] = []) => {
  const chain: any = {
    values: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
  };
  chain.values.mockReturnValue(chain);
  return chain;
};

const makeUpdateChain = (returningResult: any[] = []) => {
  const chain: any = {
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
};

describe('CommandsService', () => {
  let service: CommandsService;
  let db: MockDb;

  const mockCommandRecord = {
    id: 'cmd-1',
    correlationId: 'corr-123',
    agentId: 'agent-1',
    jobId: 'job-1',
    commandType: 'start',
    state: 'sent',
    payload: {},
    errorMessage: null,
    ackedAt: null,
    sentAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAckedRecord = {
    ...mockCommandRecord,
    state: 'acked',
    ackedAt: new Date(),
  };

  const mockFailedRecord = {
    ...mockCommandRecord,
    state: 'failed',
    errorMessage: 'Something went wrong',
  };

  const mockTimeoutRecord = {
    ...mockCommandRecord,
    state: 'timeout',
    errorMessage: 'No acknowledgment received from agent',
  };

  beforeEach(() => {
    db = {
      db: {
        insert: jest.fn(),
        select: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new CommandsService(db as unknown as DatabaseService);
  });

  describe('sendCommand', () => {
    it('creates a command record with sent state and returns it', async () => {
      const insertChain = makeInsertChain([mockCommandRecord]);
      db.db.insert.mockReturnValueOnce(insertChain);

      const result = await service.sendCommand({
        agentId: 'agent-1',
        jobId: 'job-1',
        commandType: 'start',
        payload: { key: 'value' },
      });

      expect(result).toEqual(mockCommandRecord);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          jobId: 'job-1',
          commandType: 'start',
          state: 'sent',
          payload: { key: 'value' },
        }),
      );
      expect(insertChain.values.mock.calls[0][0]).toHaveProperty(
        'correlationId',
      );
      expect(insertChain.values.mock.calls[0][0]).toHaveProperty('sentAt');
    });
  });

  describe('acknowledgeCommand', () => {
    it('updates state to acked with ackedAt timestamp', async () => {
      const updateChain = makeUpdateChain([mockAckedRecord]);
      db.db.update.mockReturnValueOnce(updateChain);

      const result = await service.acknowledgeCommand('corr-123');

      expect(result).toEqual(mockAckedRecord);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'acked',
        }),
      );
      expect(updateChain.set.mock.calls[0][0]).toHaveProperty('ackedAt');
      expect(updateChain.set.mock.calls[0][0].ackedAt).toBeInstanceOf(Date);
    });

    it('throws error when command not found', async () => {
      const updateChain = makeUpdateChain([]);
      db.db.update.mockReturnValueOnce(updateChain);

      await expect(service.acknowledgeCommand('non-existent')).rejects.toThrow(
        'Command not found: non-existent',
      );
    });
  });

  describe('failCommand', () => {
    it('updates state to failed with error message', async () => {
      const updateChain = makeUpdateChain([mockFailedRecord]);
      db.db.update.mockReturnValueOnce(updateChain);

      const result = await service.failCommand(
        'corr-123',
        'Something went wrong',
      );

      expect(result).toEqual(mockFailedRecord);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          errorMessage: 'Something went wrong',
        }),
      );
    });

    it('throws error when command not found', async () => {
      const updateChain = makeUpdateChain([]);
      db.db.update.mockReturnValueOnce(updateChain);

      await expect(
        service.failCommand('non-existent', 'error'),
      ).rejects.toThrow('Command not found: non-existent');
    });
  });

  describe('timeoutCommand', () => {
    it('updates state to timeout', async () => {
      const updateChain = makeUpdateChain([mockTimeoutRecord]);
      db.db.update.mockReturnValueOnce(updateChain);

      const result = await service.timeoutCommand('corr-123');

      expect(result).toEqual(mockTimeoutRecord);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'timeout',
          errorMessage: 'No acknowledgment received from agent',
        }),
      );
    });

    it('throws error when command not found', async () => {
      const updateChain = makeUpdateChain([]);
      db.db.update.mockReturnValueOnce(updateChain);

      await expect(service.timeoutCommand('non-existent')).rejects.toThrow(
        'Command not found: non-existent',
      );
    });
  });

  describe('getCommandHistory', () => {
    it('returns commands ordered by createdAt', async () => {
      const selectChain = makeSelectChain([mockCommandRecord]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getCommandHistory('job-1');

      expect(result).toEqual([mockCommandRecord]);
      expect(selectChain.from).toHaveBeenCalled();
      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.orderBy).toHaveBeenCalled();
      expect(selectChain.orderBy).toHaveBeenCalledWith(
        expect.anything(), // orders by createdAt
      );
    });

    it('returns empty array when no commands exist', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getCommandHistory('job-nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getCommandByCorrelationId', () => {
    it('returns command when found', async () => {
      const selectChain = makeSelectChain([mockCommandRecord]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getCommandByCorrelationId('corr-123');

      expect(result).toEqual(mockCommandRecord);
      expect(selectChain.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when not found', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getCommandByCorrelationId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getPendingCommands', () => {
    it('returns only commands with sent state', async () => {
      const pendingCmds = [
        { ...mockCommandRecord, id: 'cmd-1' },
        { ...mockCommandRecord, id: 'cmd-2' },
      ];
      const selectChain = makeSelectChain(pendingCmds);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getPendingCommands('agent-1');

      expect(result).toEqual(pendingCmds);
      expect(result).toHaveLength(2);
      expect(selectChain.where).toHaveBeenCalledWith(expect.anything());
    });

    it('returns empty array when no pending commands', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.getPendingCommands('agent-1');

      expect(result).toEqual([]);
    });
  });

  describe('checkAndHandleTimeouts', () => {
    it('marks commands older than 30 seconds as timed out', async () => {
      const oldCommand = {
        ...mockCommandRecord,
        id: 'cmd-old',
        correlationId: 'corr-old',
        sentAt: new Date(Date.now() - 60000), // 60 seconds ago
      };
      const selectChain = makeSelectChain([oldCommand]);
      db.db.select.mockReturnValueOnce(selectChain);

      const timeoutUpdateChain = makeUpdateChain([mockTimeoutRecord]);
      db.db.update.mockReturnValueOnce(timeoutUpdateChain);

      const result = await service.checkAndHandleTimeouts();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockTimeoutRecord);
    });

    it('returns empty array when no commands are timed out', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.checkAndHandleTimeouts();

      expect(result).toEqual([]);
    });
  });
});
