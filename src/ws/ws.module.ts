import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';
import { AgentAuthModule } from '../agent-auth/agent-auth.module';

@Module({
  imports: [AgentAuthModule],
  providers: [AgentGateway],
  exports: [AgentGateway],
})
export class WsModule {}
