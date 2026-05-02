import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { WsModule } from '../ws/ws.module';
import { AgentAuthService } from '../agent-auth/agent-auth.service';
import { AgentFilesController } from './files.controller';
import { AgentAuthGuard } from './files.controller';
import { CommandsService } from './commands.service';
import { JobReassignmentService } from './job-reassignment.service';

@Module({
  imports: [DatabaseModule, JwtModule, WsModule],
  providers: [AgentAuthService, AgentAuthGuard, CommandsService, JobReassignmentService],
  controllers: [AgentFilesController],
  exports: [JobReassignmentService],
})
export class AgentModule {}
