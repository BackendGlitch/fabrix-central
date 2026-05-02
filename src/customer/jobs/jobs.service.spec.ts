import { JobsService } from './jobs.service';
import { DatabaseService } from '../../database/database.service';
import { ConfigService } from '@nestjs/config';
import type { AgentGateway } from '../../ws/agent.gateway';
import type { OwnerGateway } from '../../ws/owner.gateway';
import type { FrontendGateway } from '../../ws/frontend.gateway';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

jest.mock('node:fs/promises');
import * as fsPromises from 'node:fs/promises';

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
    innerJoin: jest.fn(),
    then: promise.then.bind(promise),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  return chain;
};

const makeInsertChain = (returningResult: any[] = []): any => {
  const chain: any = {
    values: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
  };
  chain.values.mockReturnValue(chain);
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
  return chain;
};

describe('JobsService', () => {
  let service: JobsService;
  let db: MockDb;
  let configService: jest.Mocked<ConfigService>;
  let agentGateway: {
    assignJobToAgent: jest.Mock;
    isAgentConnected: jest.Mock;
  };
  let ownerGateway: {
    notifyNewPendingJobs: jest.Mock;
    notifyJobStatusUpdate: jest.Mock;
  };
  let frontendGateway: { broadcastJobStatusChange: jest.Mock };

  const mockFileRecord = {
    id: 'file-1',
    filename: '12345-abc.stl',
    originalName: 'test.stl',
    mimeType: 'model/stl',
    size: '1024',
    storagePath: '/uploads/jobs/12345-abc.stl',
    checksum: 'abcdef123456',
    uploadedAt: new Date(),
    createdAt: new Date(),
  };

  const mockJobRecord = {
    id: 'job-1',
    name: 'Test Job',
    description: 'A test job',
    status: 'pending_owner_approval',
    fileId: 'file-1',
    customerId: 'customer-1',
    printerId: 'printer-1',
    metadata: { dimensions: { width: 10, height: 10, depth: 10 } },
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    db = {
      db: {
        insert: jest.fn(),
        select: jest.fn(),
        update: jest.fn(),
      },
    };

    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    agentGateway = {
      assignJobToAgent: jest.fn(),
      isAgentConnected: jest.fn().mockReturnValue(true),
    };
    ownerGateway = {
      notifyNewPendingJobs: jest.fn(),
      notifyJobStatusUpdate: jest.fn(),
    };
    frontendGateway = { broadcastJobStatusChange: jest.fn() };

    configService.get.mockReturnValue('./uploads/jobs');
    (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);

    service = new JobsService(
      db as unknown as DatabaseService,
      configService,
      agentGateway as unknown as AgentGateway,
      ownerGateway as unknown as OwnerGateway,
      frontendGateway as unknown as FrontendGateway,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadSTL', () => {
    it('rejects null file', async () => {
      await expect(service.uploadSTL(null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects invalid mime type', async () => {
      const file = {
        mimetype: 'image/png',
        originalname: 'test.png',
        size: 1000,
        buffer: Buffer.from('test'),
      };

      await expect(service.uploadSTL(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts valid STL mime type', async () => {
      const file = {
        mimetype: 'model/stl',
        originalname: 'test.stl',
        size: 1000,
        buffer: Buffer.from('stl content'),
      };

      const insertChain = makeInsertChain([mockFileRecord]);
      db.db.insert.mockReturnValueOnce(insertChain);

      const result = await service.uploadSTL(file);

      expect(result.message).toBe('File uploaded successfully');
      expect(result.file.id).toBe('file-1');
      expect(result.file.originalName).toBe('test.stl');
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'test.stl',
          mimeType: 'model/stl',
          size: '1000',
        }),
      );
    });

    it('accepts STL file with .stl extension even if mime is unknown', async () => {
      const file = {
        mimetype: 'application/octet-stream',
        originalname: 'model.stl',
        size: 1000,
        buffer: Buffer.from('stl content'),
      };

      const insertChain = makeInsertChain([mockFileRecord]);
      db.db.insert.mockReturnValueOnce(insertChain);

      const result = await service.uploadSTL(file);

      expect(result.message).toBe('File uploaded successfully');
    });

    it('rejects files exceeding 500MB', async () => {
      const file = {
        mimetype: 'model/stl',
        originalname: 'large.stl',
        size: 600 * 1024 * 1024,
        buffer: Buffer.from('large'),
      };

      await expect(service.uploadSTL(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findAvailablePrinter', () => {
    it('picks the most recently seen active agent', async () => {
      const agents = [
        { id: 'agent-2', lastSeenAt: new Date('2024-01-02T00:00:00Z') },
        { id: 'agent-1', lastSeenAt: new Date('2024-01-01T00:00:00Z') },
      ];

      const selectChain = makeSelectChain(agents);
      db.db.select.mockReturnValueOnce(selectChain);

      // We need to access the private method.
      // Using type assertion to bypass TypeScript
      const result = await (service as any).findAvailablePrinter();

      expect(result).toBe('agent-2');

      expect(selectChain.where).toHaveBeenCalled();
      expect(selectChain.orderBy).toHaveBeenCalled();
    });

    it('returns null if no active agents', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await (service as any).findAvailablePrinter();

      expect(result).toBeNull();
    });
  });

  describe('createJob', () => {
    const createJobDto = {
      fileId: 'file-1',
      name: 'Test Print',
      description: 'A sample print job',
      metadata: {
        dimensions: { width: 10, height: 10, depth: 10 },
      },
    };

    beforeEach(() => {
      configService.get.mockReturnValue('./uploads/jobs');
    });

    it('creates a job with pending_owner_approval if printer found', async () => {
      // Find file
      const fileSelectChain = makeSelectChain([mockFileRecord]);
      db.db.select.mockReturnValueOnce(fileSelectChain);

      // findAvailablePrinter
      const agentSelectChain = makeSelectChain([
        { id: 'printer-1', lastSeenAt: new Date() },
      ]);
      db.db.select.mockReturnValueOnce(agentSelectChain);

      // Insert job
      const insertChain = makeInsertChain([mockJobRecord]);
      db.db.insert.mockReturnValueOnce(insertChain);

      // notifyOwnerAboutPendingJob -> find agent
      const agentSelectChain2 = makeSelectChain([
        { id: 'printer-1', ownerId: 'owner-1' },
      ]);
      db.db.select.mockReturnValueOnce(agentSelectChain2);

      // countPendingJobsForOwner -> get agents for owner
      const countAgentsSelectChain = makeSelectChain([{ id: 'printer-1' }]);
      db.db.select.mockReturnValueOnce(countAgentsSelectChain);

      // countPendingJobsForOwner -> count jobs
      const countJobsSelectChain = makeSelectChain([{ count: '1' }]);
      db.db.select.mockReturnValueOnce(countJobsSelectChain);

      // getPendingJobForOwner
      const pendingSelectChain = makeSelectChain([
        {
          id: 'job-1',
          name: 'Test Print',
          description: null,
          status: 'pending_owner_approval',
          fileId: 'file-1',
          customerId: 'customer-1',
          printerId: 'printer-1',
          metadata: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          filename: 'test.stl',
          originalName: 'test.stl',
          mimeType: 'model/stl',
          size: '1024',
          uploadedAt: new Date(),
          customerName: 'Customer',
          printerDisplayName: 'Printer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(pendingSelectChain);

      const result = await service.createJob('customer-1', createJobDto);

      expect(result.status).toBe('pending_owner_approval');
      expect(result.printerId).toBe('printer-1');
      expect(ownerGateway.notifyNewPendingJobs).toHaveBeenCalled();
    });

    it('creates a job with pending status if no printer available', async () => {
      // Find file
      const fileSelectChain = makeSelectChain([mockFileRecord]);
      db.db.select.mockReturnValueOnce(fileSelectChain);

      // findAvailablePrinter returns null
      const agentSelectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(agentSelectChain);

      const jobRecordPending = {
        ...mockJobRecord,
        status: 'pending',
        printerId: null,
      };
      const insertChain = makeInsertChain([jobRecordPending]);
      db.db.insert.mockReturnValueOnce(insertChain);

      const result = await service.createJob('customer-1', createJobDto);

      expect(result.status).toBe('pending');
      expect(result.printerId).toBeNull();
      expect(ownerGateway.notifyNewPendingJobs).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when fileId is missing', async () => {
      await expect(
        service.createJob('customer-1', { name: 'test' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when file not found', async () => {
      const fileSelectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(fileSelectChain);

      await expect(
        service.createJob('customer-1', createJobDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listCustomerJobs', () => {
    it('returns jobs ordered by createdAt desc', async () => {
      const rows = [
        {
          id: 'job-1',
          name: 'Job 1',
          description: null,
          status: 'pending',
          fileId: 'file-1',
          customerId: 'customer-1',
          printerId: null,
          metadata: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          filename: 'test.stl',
          originalName: 'test.stl',
          mimeType: 'model/stl',
          size: '1024',
          uploadedAt: new Date(),
        },
      ];

      const selectChain = makeSelectChain(rows);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.listCustomerJobs('customer-1');

      expect(result.count).toBe(1);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe('job-1');
      expect(result.jobs[0].file.filename).toBe('test.stl');
      expect(selectChain.where).toHaveBeenCalledWith(expect.anything());
      expect(selectChain.orderBy).toHaveBeenCalledWith(expect.anything());
    });

    it('returns empty array for customer with no jobs', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      const result = await service.listCustomerJobs('customer-empty');

      expect(result.count).toBe(0);
      expect(result.jobs).toEqual([]);
    });
  });

  describe('listPendingJobsForOwner', () => {
    it('returns pending_owner_approval jobs for owner agents', async () => {
      const ownerAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
      const agentSelect = makeSelectChain(ownerAgents);
      db.db.select.mockReturnValueOnce(agentSelect);

      const rows = [
        {
          id: 'job-1',
          name: 'Pending Job',
          description: null,
          status: 'pending_owner_approval',
          fileId: 'file-1',
          customerId: 'customer-1',
          printerId: 'agent-1',
          metadata: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          filename: 'test.stl',
          originalName: 'test.stl',
          mimeType: 'model/stl',
          size: '1024',
          uploadedAt: new Date(),
          customerName: 'Test Customer',
          printerDisplayName: 'Printer-1',
        },
      ];

      const jobSelect = makeSelectChain(rows);
      db.db.select.mockReturnValueOnce(jobSelect);

      const result = await service.listPendingJobsForOwner('owner-1');

      expect(result.count).toBe(1);
      expect(result.jobs[0].id).toBe('job-1');
      expect(result.jobs[0].status).toBe('pending_owner_approval');
      expect(result.jobs[0].customerName).toBe('Test Customer');
      expect(result.jobs[0].printerDisplayName).toBe('Printer-1');
    });

    it('returns empty when owner has no agents', async () => {
      const agentSelect = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(agentSelect);

      const result = await service.listPendingJobsForOwner('owner-empty');

      expect(result.count).toBe(0);
      expect(result.jobs).toEqual([]);
    });
  });

  describe('cancelCustomerJob', () => {
    it('cancels a job in pending_owner_approval status', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'pending_owner_approval',
        printerId: 'agent-1',
      };

      const selectChain = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(selectChain);

      // updateJobStatus called internally
      // It selects status, printerId, customerId then may select printer owner
      const jobStatusSelect = makeSelectChain([
        {
          status: 'pending_owner_approval',
          printerId: 'agent-1',
          customerId: 'customer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(jobStatusSelect);

      const updateChain = makeUpdateChain([
        {
          ...mockJobRecord,
          status: 'cancelled',
          completedAt: new Date(),
        },
      ]);
      db.db.update.mockReturnValueOnce(updateChain);

      const fileSelect = makeSelectChain([mockFileRecord]);
      db.db.select.mockReturnValueOnce(fileSelect);

      // notifyOwnerAboutJobStatusUpdate
      const jobInfoSelect = makeSelectChain([
        { printerId: 'agent-1', customerId: 'customer-1' },
      ]);
      db.db.select.mockReturnValueOnce(jobInfoSelect);

      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      const result = await service.cancelCustomerJob('job-1', 'customer-1');

      expect(result.message).toBe('Job cancelled successfully');
      expect(result.job.status).toBe('cancelled');
    });

    it('rejects cancellation of non-cancellable status', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'printing',
        printerId: 'agent-1',
      };

      const selectChain = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(selectChain);

      await expect(
        service.cancelCustomerJob('job-1', 'customer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cancellation by wrong customer', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'pending_owner_approval',
        printerId: 'agent-1',
      };

      const selectChain = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(selectChain);

      await expect(
        service.cancelCustomerJob('job-1', 'other-customer'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when job does not exist', async () => {
      const selectChain = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(selectChain);

      await expect(
        service.cancelCustomerJob('non-existent', 'customer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getJobTracking', () => {
    it('returns current snapshot and timeline from job_events', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'printing',
        metadata: {
          progress: 50,
          current_layer: 10,
          total_layers: 20,
          eta_minutes: 30,
          progress_updated_at: '2024-01-01T12:00:00Z',
        },
      };

      const jobSelect = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const events = [
        {
          type: 'progress',
          data: { progress: 25 },
          createdAt: new Date('2024-01-01T11:00:00Z'),
        },
        {
          type: 'progress',
          data: { progress: 50 },
          createdAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];

      const eventSelect = makeSelectChain(events);
      db.db.select.mockReturnValueOnce(eventSelect);

      const result = await service.getJobTracking('job-1', 'customer-1');

      expect(result.current.progress).toBe(50);
      expect(result.current.status).toBe('printing');
      expect(result.current.currentLayer).toBe(10);
      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].type).toBe('progress');
    });

    it('throws NotFoundException when job does not exist', async () => {
      const jobSelect = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(jobSelect);

      await expect(
        service.getJobTracking('non-existent', 'customer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for wrong customer', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'printing',
        metadata: {},
      };

      const jobSelect = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(jobSelect);

      await expect(
        service.getJobTracking('job-1', 'wrong-customer'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns default values when metadata is empty', async () => {
      const jobRow = {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'pending',
        metadata: {},
      };

      const jobSelect = makeSelectChain([jobRow]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const eventSelect = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(eventSelect);

      const result = await service.getJobTracking('job-1', 'customer-1');

      expect(result.current.progress).toBe(0);
      expect(result.current.currentLayer).toBe(0);
      expect(result.current.totalLayers).toBe(0);
      expect(result.current.etaMinutes).toBe(0);
      expect(result.timeline).toEqual([]);
    });
  });

  describe('updateJobStatus', () => {
    it('updates job status and returns updated job', async () => {
      // Ownership check queries (service selects status, printerId, customerId first)
      const jobSelect = makeSelectChain([
        {
          status: 'pending_owner_approval',
          printerId: 'printer-1',
          customerId: 'customer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const printerSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(printerSelect);

      // Update query
      const updatedJob = {
        ...mockJobRecord,
        status: 'queued',
        updatedAt: new Date(),
      };
      const updateChain = makeUpdateChain([updatedJob]);
      db.db.update.mockReturnValueOnce(updateChain);

      // File query
      const fileSelect = makeSelectChain([mockFileRecord]);
      db.db.select.mockReturnValueOnce(fileSelect);

      // notifyOwnerAboutJobStatusUpdate -> job info
      const jobInfoSelect = makeSelectChain([{ printerId: 'printer-1' }]);
      db.db.select.mockReturnValueOnce(jobInfoSelect);

      // agent query
      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      const result = await service.updateJobStatus(
        'job-1',
        'queued',
        'owner-1',
      );

      expect(result.status).toBe('queued');
      expect(agentGateway.assignJobToAgent).toHaveBeenCalledWith(
        'printer-1',
        expect.objectContaining({ id: 'job-1' }),
      );
      expect(ownerGateway.notifyJobStatusUpdate).toHaveBeenCalled();
    });

    it('throws ForbiddenException when owner does not own the printer', async () => {
      const jobSelect = makeSelectChain([
        {
          status: 'pending_owner_approval',
          printerId: 'printer-1',
          customerId: 'customer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const printerSelect = makeSelectChain([{ ownerId: 'other-owner' }]);
      db.db.select.mockReturnValueOnce(printerSelect);

      await expect(
        service.updateJobStatus('job-1', 'queued', 'owner-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when job not found', async () => {
      const jobSelect = makeSelectChain([]);
      db.db.select.mockReturnValueOnce(jobSelect);

      await expect(
        service.updateJobStatus('non-existent', 'queued', 'owner-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets startedAt when status is printing', async () => {
      const jobSelect = makeSelectChain([
        {
          status: 'queued',
          printerId: 'printer-1',
          customerId: 'customer-1',
        },
      ]);
      db.db.select.mockReturnValueOnce(jobSelect);

      const printerSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(printerSelect);

      const updatedJob = {
        ...mockJobRecord,
        status: 'printing',
        startedAt: new Date(),
      };
      const updateChain = makeUpdateChain([updatedJob]);
      db.db.update.mockReturnValueOnce(updateChain);

      const fileSelect = makeSelectChain([mockFileRecord]);
      db.db.select.mockReturnValueOnce(fileSelect);

      const jobInfoSelect = makeSelectChain([{ printerId: 'printer-1' }]);
      db.db.select.mockReturnValueOnce(jobInfoSelect);

      const agentSelect = makeSelectChain([{ ownerId: 'owner-1' }]);
      db.db.select.mockReturnValueOnce(agentSelect);

      const result = await service.updateJobStatus(
        'job-1',
        'printing',
        'owner-1',
      );

      expect(result.status).toBe('printing');
      expect(result.startedAt).not.toBeNull();
    });
  });
});
