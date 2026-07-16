import { Module } from '@nestjs/common';
import { CandidateVerificationController } from './candidate-verification.controller';
import { CandidateVerificationService } from './candidate-verification.service';

@Module({
  controllers: [CandidateVerificationController],
  providers: [CandidateVerificationService],
  exports: [CandidateVerificationService],
})
export class CandidateVerificationModule {}
