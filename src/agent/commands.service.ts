import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { eq, and, lt } from 'drizzle-orm';
import { agentCommands } from '../database/schema';

export type CommandType = 'start' | 'pause' | 'cancel';
export type CommandState = 'sent' | 'acked' | 'failed' | 'timeout';

interface SendCommandDto {
  agentId: string;
  jobId: string;
  commandType: CommandType;
  payload?: Record<string, unknown>;
}

interface CommandRecord {
  id: string;
  correlationId: string;
  agentId: string;
  jobId: string;
  commandType: CommandType;
  state: CommandState;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  ackedAt: Date | null;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Send a command to an agent with correlation ID for tracking
   */
  async sendCommand(dto: SendCommandDto): Promise<CommandRecord> {
    const correlationId = crypto.randomUUID();
    const timestamp = new Date();

    this.logger.log(
      `[COMMAND SENT] correlationId=${correlationId} agentId=${dto.agentId} jobId=${dto.jobId} type=${dto.commandType}`,
    );

    const [command] = await this.db.db
      .insert(agentCommands)
      .values({
        correlationId,
        agentId: dto.agentId,
        jobId: dto.jobId,
        commandType: dto.commandType,
        state: 'sent',
        payload: dto.payload || {},
        sentAt: timestamp,
      })
      .returning();

    this.logger.debug(
      `Command record created: ${JSON.stringify({ id: command.id, correlationId })}`,
    );

    return command as CommandRecord;
  }

  /**
   * Mark a command as acknowledged by agent
   */
  async acknowledgeCommand(correlationId: string): Promise<CommandRecord> {
    const timestamp = new Date();

    this.logger.log(
      `[COMMAND ACK] correlationId=${correlationId} state transition: sent -> acked`,
    );

    const [updated] = await this.db.db
      .update(agentCommands)
      .set({
        state: 'acked',
        ackedAt: timestamp,
      })
      .where(eq(agentCommands.correlationId, correlationId))
      .returning();

    if (!updated) {
      this.logger.warn(
        `[COMMAND ACK FAILED] correlationId=${correlationId} - command not found`,
      );
      throw new Error(`Command not found: ${correlationId}`);
    }

    this.logger.debug(
      `Command acknowledged: ${JSON.stringify({ correlationId, ackedAt: timestamp })}`,
    );

    return updated as CommandRecord;
  }

  /**
   * Mark a command as failed
   */
  async failCommand(
    correlationId: string,
    errorMessage: string,
  ): Promise<CommandRecord> {
    this.logger.error(
      `[COMMAND FAILED] correlationId=${correlationId} error="${errorMessage}"`,
    );

    const [updated] = await this.db.db
      .update(agentCommands)
      .set({
        state: 'failed',
        errorMessage,
      })
      .where(eq(agentCommands.correlationId, correlationId))
      .returning();

    if (!updated) {
      this.logger.warn(
        `[COMMAND FAIL TRACKING FAILED] correlationId=${correlationId} - command not found`,
      );
      throw new Error(`Command not found: ${correlationId}`);
    }

    return updated as CommandRecord;
  }

  /**
   * Mark a command as timed out (no ack received)
   */
  async timeoutCommand(correlationId: string): Promise<CommandRecord> {
    this.logger.warn(
      `[COMMAND TIMEOUT] correlationId=${correlationId} - no acknowledgment received`,
    );

    const [updated] = await this.db.db
      .update(agentCommands)
      .set({
        state: 'timeout',
        errorMessage: 'No acknowledgment received from agent',
      })
      .where(eq(agentCommands.correlationId, correlationId))
      .returning();

    if (!updated) {
      this.logger.warn(
        `[COMMAND TIMEOUT TRACKING FAILED] correlationId=${correlationId} - command not found`,
      );
      throw new Error(`Command not found: ${correlationId}`);
    }

    return updated as CommandRecord;
  }

  /**
   * Get command history for a job
   */
  async getCommandHistory(jobId: string): Promise<CommandRecord[]> {
    const commands = await this.db.db
      .select()
      .from(agentCommands)
      .where(eq(agentCommands.jobId, jobId))
      .orderBy(agentCommands.createdAt);

    return commands as CommandRecord[];
  }

  /**
   * Get command by correlation ID
   */
  async getCommandByCorrelationId(
    correlationId: string,
  ): Promise<CommandRecord | null> {
    const [command] = await this.db.db
      .select()
      .from(agentCommands)
      .where(eq(agentCommands.correlationId, correlationId))
      .limit(1);

    return (command as CommandRecord) || null;
  }

  /**
   * Get all unacknowledged commands for an agent (for timeout checking)
   */
  async getPendingCommands(agentId: string): Promise<CommandRecord[]> {
    const commands = await this.db.db
      .select()
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.agentId, agentId),
          eq(agentCommands.state, 'sent'),
        ),
      )
      .orderBy(agentCommands.sentAt);

    return commands as CommandRecord[];
  }

  /**
   * Check for command timeouts (>30 seconds with no ack)
   */
  async checkAndHandleTimeouts(): Promise<CommandRecord[]> {
    const thirtySecondsAgo = new Date(Date.now() - 30000);

    const timedOutCommands = await this.db.db
      .select()
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.state, 'sent'),
          lt(agentCommands.sentAt, thirtySecondsAgo),
        ),
      );

    const results: CommandRecord[] = [];
    for (const cmd of timedOutCommands) {
      try {
        const updated = await this.timeoutCommand(cmd.correlationId);
        results.push(updated);
      } catch (error) {
        this.logger.error(
          `Failed to timeout command ${cmd.correlationId}:`,
          error,
        );
      }
    }

    return results;
  }
}
