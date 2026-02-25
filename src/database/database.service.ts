import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  public db: ReturnType<typeof drizzle>;
  private client: ReturnType<typeof postgres>;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }

    this.client = postgres(url, { ssl: 'require' });
    this.db = drizzle(this.client, { schema });
    this.logger.log('Database connection initialized');
  }
}
