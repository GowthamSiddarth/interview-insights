import { Module } from '@nestjs/common';
import { InterviewProcessesController } from './interview-processes.controller';
import { InterviewProcessesService } from './interview-processes.service';

@Module({
  controllers: [InterviewProcessesController],
  providers: [InterviewProcessesService],
  exports: [InterviewProcessesService],
})
export class InterviewProcessesModule {}
