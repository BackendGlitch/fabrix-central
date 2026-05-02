import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AgentGateway } from './agent.gateway';
import { OwnerGateway } from './owner.gateway';
import { FrontendGateway } from './frontend.gateway';
import { AgentAuthModule } from '../agent-auth/agent-auth.module';
import { DatabaseModule } from '../database/database.module';
import { CommandsService } from '../agent/commands.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    AgentAuthModule,
    DatabaseModule,
  ],
  providers: [AgentGateway, OwnerGateway, FrontendGateway, CommandsService],
  exports: [AgentGateway, OwnerGateway, FrontendGateway, CommandsService],
})
export class WsModule {}
