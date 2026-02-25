import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [AgentGateway],
})
export class WsModule {}
