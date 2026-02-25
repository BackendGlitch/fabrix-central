import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { sql } from 'drizzle-orm';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly db: DatabaseService) {}

  async check() {
    try {
      await this.db.db.execute(sql`SELECT 1`);
      return {
        status: 'ok',
        service: 'fabrix-central',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      this.logger.error('Database health check failed', message);
      return {
        status: 'degraded',
        service: 'fabrix-central',
        database: 'disconnected',
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
