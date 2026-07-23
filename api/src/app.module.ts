import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { CandidatesModule } from './candidates/candidates.module';
import { CompaniesModule } from './companies/companies.module';
import { InterviewProcessesModule } from './interview-processes/interview-processes.module';
import { RoundsModule } from './rounds/rounds.module';
import { RoundRatingsModule } from './round-ratings/round-ratings.module';
import { RecruitersModule } from './recruiters/recruiters.module';
import { RecruiterInteractionsModule } from './recruiter-interactions/recruiter-interactions.module';
import { RecruiterRatingsModule } from './recruiter-ratings/recruiter-ratings.module';
import { OverallReviewsModule } from './overall-reviews/overall-reviews.module';
import { ModerationModule } from './moderation/moderation.module';
import { CandidateVerificationModule } from './candidate-verification/candidate-verification.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    PrismaModule,
    AdminAuthModule,
    HealthModule,
    CandidatesModule,
    CompaniesModule,
    InterviewProcessesModule,
    RoundsModule,
    RoundRatingsModule,
    RecruitersModule,
    RecruiterInteractionsModule,
    RecruiterRatingsModule,
    OverallReviewsModule,
    ModerationModule,
    CandidateVerificationModule,
    AnalyticsModule,
    SearchModule,
  ],
})
export class AppModule {}
