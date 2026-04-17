import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AgentGateway } from './agent.gateway';
import { OwnerGateway } from './owner.gateway';
import { AgentAuthModule } from '../agent-auth/agent-auth.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    AgentAuthModule,
    DatabaseModule,
  ],
  providers: [AgentGateway, OwnerGateway],
  exports: [AgentGateway, OwnerGateway],
})
export class WsModule {}
