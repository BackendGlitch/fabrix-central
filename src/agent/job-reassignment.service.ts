import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AgentGateway } from '../ws/agent.gateway';
import { eq, and } from 'drizzle-orm';
import { jobs } from '../database/schema';

/**
 * Background service that periodically sweeps for queued jobs
 * whose agents are offline and retries sending them
 */
@Injectable()
export class JobReassignmentService implements OnModuleInit {
  private readonly logger = new Logger(JobReassignmentService.name);
  private sweepInterval: NodeJS.Timeout | null = null;
  private readonly SWEEP_INTERVAL_MS = 30000; // 30 seconds

  constructor(
    private readonly db: DatabaseService,
    private readonly agentGateway: AgentGateway,
  ) {}

  onModuleInit() {
    this.startSweep();
  }

  /**
   * Start the background sweep job
   */
  private startSweep(): void {
    this.logger.log(
      `Starting job reassignment sweep (interval: ${this.SWEEP_INTERVAL_MS}ms)`,
    );

    this.sweepInterval = setInterval(async () => {
      try {
        await this.sweepOfflineQueuedJobs();
      } catch (error) {
        this.logger.error('Sweep job failed:', error);
      }
    }, this.SWEEP_INTERVAL_MS);

    // Don't block the event loop
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /**
   * Find queued jobs and retry sending to their agents
   */
  private async sweepOfflineQueuedJobs(): Promise<void> {
    try {
      // Get all queued jobs
      const queuedJobs = await this.db.db
        .select({
          id: jobs.id,
          printerId: jobs.printerId,
          name: jobs.name,
          fileId: jobs.fileId,
          metadata: jobs.metadata,
          updatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .where(eq(jobs.status, 'queued'));

      if (queuedJobs.length === 0) {
        return;
      }

      // Get list of currently connected agents
      const connectedAgents = new Set(this.agentGateway.getConnectedAgentIds());

      let retriedCount = 0;

      // Try to send jobs to offline agents
      for (const job of queuedJobs) {
        if (!job.printerId) {
          continue;
        }

        // Skip if agent is already connected (they already got the job)
        if (connectedAgents.has(job.printerId)) {
          continue;
        }

        // Try to send to the agent (will fail silently if still offline)
        const sent = this.agentGateway.assignJobToAgent(job.printerId, {
          id: job.id,
          name: job.name,
          fileId: job.fileId,
          metadata: job.metadata,
        });

        if (sent) {
          this.logger.debug(
            `[SWEEP] Resent queued job ${job.id} to agent ${job.printerId}`,
          );
          retriedCount++;
        }
      }

      if (retriedCount > 0) {
        this.logger.log(
          `[SWEEP] Successfully retried ${retriedCount}/${queuedJobs.filter((j) => !connectedAgents.has(j.printerId!)).length} offline jobs`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to sweep offline queued jobs:', error);
    }
  }

  /**
   * Stop the background sweep
   */
  stopSweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
      this.logger.log('Job reassignment sweep stopped');
    }
  }
}
