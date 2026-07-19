import { Module } from '@nestjs/common';
import { RecruiterInteractionsController } from './recruiter-interactions.controller';
import { RecruiterInteractionsService } from './recruiter-interactions.service';
import { RecruitersModule } from '../recruiters/recruiters.module';

@Module({
  imports: [RecruitersModule],
  controllers: [RecruiterInteractionsController],
  providers: [RecruiterInteractionsService],
  exports: [RecruiterInteractionsService],
})
export class RecruiterInteractionsModule {}