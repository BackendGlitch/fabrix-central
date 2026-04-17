import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WsModule } from '../../ws/ws.module';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { OwnerJobsController } from '../../owner/jobs.controller';

@Module({
  imports: [DatabaseModule, WsModule],
  providers: [JobsService],
  controllers: [JobsController, OwnerJobsController],
  exports: [JobsService],
})
export class JobsModule {}
