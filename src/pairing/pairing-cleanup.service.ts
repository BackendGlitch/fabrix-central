import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { agentPairings, agentSessions } from '../database/schema';

@Injectable()
export class PairingCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PairingCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.cleanup();
    }, 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async cleanup(): Promise<void> {
    const now = new Date();
    try {
      await this.db.db
        .update(agentPairings)
        .set({ status: 'expired' })
        .where(
          and(
            lt(agentPairings.expiresAt, now),
            eq(agentPairings.status, 'pending'),
          ),
        );

      await this.db.db
        .update(agentSessions)
        .set({ revokedAt: now })
        .where(
          and(
            lt(agentSessions.expiresAt, now),
            isNull(agentSessions.revokedAt),
          ),
        );

      this.logger.debug('Pairing/session cleanup completed');
    } catch (error: unknown) {
      const code = this.postgresErrorCode(error);
      if (code === '42P01') {
        this.logger.warn(
          'Pairing cleanup skipped: database schema missing agent tables. Run migrations (e.g. pnpm db:push).',
        );
        return;
      }
      this.logger.error(`Pairing cleanup failed: ${error}`);
    }
  }

  private postgresErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const withCause = error as { cause?: { code?: string }; code?: string };
    if (typeof withCause.cause?.code === 'string') {
      return withCause.cause.code;
    }
    if (typeof withCause.code === 'string') {
      return withCause.code;
    }
    return undefined;
  }
}
