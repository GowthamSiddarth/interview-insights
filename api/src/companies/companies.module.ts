import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyCreationThrottleGuard } from './company-creation-throttle.guard';
import { CompanyCreationThrottleService } from './company-creation-throttle.service';
import { ModerationModule } from '../moderation/moderation.module';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { EditThrottleModule } from '../common/edit-throttle.module';

@Module({
  // ModerationModule replaces SearchModule here (GitHub issue #369,
  // Phase 35) — company creation now enqueues via ModerationService
  // instead of indexing to OpenSearch directly; indexing happens at
  // approval time from within ModerationService itself.
  //
  // GitHub issue #697 (Phase 50, D104) — EditThrottleModule, same
  // repeated-edit-driven-re-enqueue abuse pattern RoundRating/
  // RecruiterRating/OverallReview already guard against, now extended to
  // a candidate's own pending/rejected company request.
  imports: [ModerationModule, CandidateAuthModule, EditThrottleModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyCreationThrottleService, CompanyCreationThrottleGuard],
  exports: [CompaniesService],
})
export class CompaniesModule {}
