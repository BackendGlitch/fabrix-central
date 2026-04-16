import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [DatabaseModule],
  providers: [JobsService],
  controllers: [JobsController],
})
export class JobsModule {}
