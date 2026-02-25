import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private pub: Redis;
  private sub: Redis;
  private messageHandler?: (channel: string, message: string) => void;

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    this.pub = new Redis(url);
    this.sub = new Redis(url);

    this.sub.on('message', (channel: string, message: string) => {
      if (this.messageHandler) this.messageHandler(channel, message);
    });

    this.sub.subscribe('ws:broadcast').then(() => {
      this.logger.log('Subscribed to channel: ws:broadcast');
    }).catch(err => this.logger.error('Subscribe error', err));
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
