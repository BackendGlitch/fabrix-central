import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WsModule } from '../ws/ws.module';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [DatabaseModule, WsModule, JobsModule],
  providers: [CustomerService],
  controllers: [CustomerController],
})
export class CustomerModule {}
