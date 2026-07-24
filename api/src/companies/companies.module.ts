import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyCreationThrottleGuard } from './company-creation-throttle.guard';
import { CompanyCreationThrottleService } from './company-creation-throttle.service';
import { SearchModule } from '../search/search.module';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';

@Module({
  imports: [SearchModule, CandidateAuthModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyCreationThrottleService, CompanyCreationThrottleGuard],
  exports: [CompaniesService],
})
export class CompaniesModule {}
