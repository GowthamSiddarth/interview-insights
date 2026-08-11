import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { CandidatesModule } from './candidates/candidates.module';
import { CompaniesModule } from './companies/companies.module';
import { InterviewProcessesModule } from './interview-processes/interview-processes.module';
import { RoundsModule } from './rounds/rounds.module';
import { RoundTypeRegistryModule } from './round-type-registry/round-type-registry.module';
import { RoundRatingsModule } from './round-ratings/round-ratings.module';
import { RecruitersModule } from './recruiters/recruiters.module';
import { RecruiterInteractionsModule } from './recruiter-interactions/recruiter-interactions.module';
import { RecruiterRatingsModule } from './recruiter-ratings/recruiter-ratings.module';
import { OverallReviewsModule } from './overall-reviews/overall-reviews.module';
import { ModerationModule } from './moderation/moderation.module';
import { CandidateAuthModule } from './candidate-auth/candidate-auth.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SearchModule } from './search/search.module';
import { MeModule } from './me/me.module';
import { BulkProcessSubmissionModule } from './bulk-process-submission/bulk-process-submission.module';
import { VerdictConsumerModule } from './verdict-consumer/verdict-consumer.module';
import { StaffAccountsModule } from './staff-accounts/staff-accounts.module';

@Module({
  imports: [
    // Enables @Interval()/@Cron() across the app — DomainEventPublisher's
    // reconnect loop and (GitHub issue #340) VerdictConsumerService's own
    // reconnect loop both need it. GitHub issue #442 (Phase 39, D71) added
    // this for ReconciliationSweepService, which moved to review-analyzer
    // as of #340/D81 — kept here for the reconnect loops above.
    ScheduleModule.forRoot(),
    PrismaModule,
    AdminAuthModule,
    HealthModule,
    CandidatesModule,
    CompaniesModule,
    InterviewProcessesModule,
    RoundsModule,
    RoundTypeRegistryModule,
    RoundRatingsModule,
    RecruitersModule,
    RecruiterInteractionsModule,
    RecruiterRatingsModule,
    OverallReviewsModule,
    ModerationModule,
    CandidateAuthModule,
    AnalyticsModule,
    SearchModule,
    MeModule,
    BulkProcessSubmissionModule,
    VerdictConsumerModule,
    StaffAccountsModule,
  ],
})
export class AppModule {}
