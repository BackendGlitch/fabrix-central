import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private pub: Redis;
  private sub: Redis;
  private messageHandler?: (channel: string, message: string) => void;

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

    const commonOpts: RedisOptions = {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 3_000);
      },
      lazyConnect: true,
    };

    this.pub = new Redis(url, commonOpts);
    this.sub = new Redis(url, commonOpts);

    this.pub.on('error', (err) =>
      this.logger.warn(`Redis pub error: ${err.message}`),
    );
    this.sub.on('error', (err) =>
      this.logger.warn(`Redis sub error: ${err.message}`),
    );

    this.connectClients();
  }

  private async connectClients() {
    try {
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      this.logger.log('Redis clients connected');
    } catch {
      this.logger.warn('Redis is unavailable — pub/sub features disabled');
      return;
    }

    this.sub.on('message', (channel: string, message: string) => {
      if (this.messageHandler) this.messageHandler(channel, message);
    });

    this.sub
      .subscribe('ws:broadcast')
      .then(() => {
        this.logger.log('Subscribed to channel: ws:broadcast');
      })
      .catch((err) => this.logger.error('Subscribe error', err));
  }

  publish(channel: string, message: string) {
    return this.pub.publish(channel, message);
  }

  onMessage(handler: (channel: string, message: string) => void) {
    this.messageHandler = handler;
  }

  async onModuleDestroy() {
    try {
      await this.pub.quit();
      await this.sub.quit();
    } catch (e) {
      this.logger.warn('Error quitting Redis clients', e as any);
    }
  }
}
