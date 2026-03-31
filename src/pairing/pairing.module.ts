import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { AgentAuthModule } from '../agent-auth/agent-auth.module';
import { WsModule } from '../ws/ws.module';
import { PairingService } from './pairing.service';
import { PairingController } from './pairing.controller';
import { PairingCleanupService } from './pairing-cleanup.service';

@Module({
  imports: [DatabaseModule, JwtModule, AgentAuthModule, WsModule],
  providers: [PairingService, PairingCleanupService],
  controllers: [PairingController],
})
export class PairingModule {}
