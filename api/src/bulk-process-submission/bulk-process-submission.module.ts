import { Module } from '@nestjs/common';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FraudChecksModule } from '../fraud-checks/fraud-checks.module';
import { RecruitersModule } from '../recruiters/recruiters.module';
import { RoundTypeRegistryModule } from '../round-type-registry/round-type-registry.module';
import { BulkProcessSubmissionController } from './bulk-process-submission.controller';
import { BulkProcessSubmissionService } from './bulk-process-submission.service';

@Module({
  imports: [CandidateAuthModule, ModerationModule, FraudChecksModule, RecruitersModule, RoundTypeRegistryModule],
  controllers: [BulkProcessSubmissionController],
  providers: [BulkProcessSubmissionService],
})
export class BulkProcessSubmissionModule {}
