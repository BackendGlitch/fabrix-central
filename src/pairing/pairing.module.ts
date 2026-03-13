import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';
import { PairingService } from './pairing.service';
import { PairingController } from './pairing.controller';

@Module({
  imports: [DatabaseModule, JwtModule],
  providers: [PairingService],
  controllers: [PairingController],
})
export class PairingModule {}