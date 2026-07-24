import { Module } from '@nestjs/common';
import { InterviewProcessesController } from './interview-processes.controller';
import { InterviewProcessesService } from './interview-processes.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';

@Module({
  imports: [CandidateAuthModule],
  controllers: [InterviewProcessesController],
  providers: [InterviewProcessesService],
  exports: [InterviewProcessesService],
})
export class InterviewProcessesModule {}
