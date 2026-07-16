import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { CandidatesModule } from './candidates/candidates.module';
import { CompaniesModule } from './companies/companies.module';
import { InterviewProcessesModule } from './interview-processes/interview-processes.module';
import { RoundsModule } from './rounds/rounds.module';
import { RoundRatingsModule } from './round-ratings/round-ratings.module';
import { ModerationModule } from './moderation/moderation.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    CandidatesModule,
    CompaniesModule,
    InterviewProcessesModule,
    RoundsModule,
    RoundRatingsModule,
    ModerationModule,
  ],
})
export class AppModule {}
