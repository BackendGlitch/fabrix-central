import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { NexaPayService } from './nexapay.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, NexaPayService],
  exports: [WalletService, NexaPayService],
})
export class WalletModule {}
