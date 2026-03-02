import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';

@Module({
  providers: [AgentGateway],
})
export class WsModule {}
