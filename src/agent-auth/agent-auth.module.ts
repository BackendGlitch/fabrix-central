import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { AgentAuthService } from './agent-auth.service';
import { AgentAuthController } from './agent-auth.controller';

@Module({
  imports: [DatabaseModule, JwtModule],
  providers: [AgentAuthService],
  controllers: [AgentAuthController],
  exports: [AgentAuthService],
})
export class AgentAuthModule {}
