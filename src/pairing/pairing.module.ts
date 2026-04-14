import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PairingService } from './pairing.service';
import { PairingController } from './pairing.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fabrix-default-secret-key-change-in-production',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [PairingService],
  controllers: [PairingController],
  exports: [PairingService],
})
export class PairingModule {}
