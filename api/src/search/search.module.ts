import { Module } from '@nestjs/common';
import { CompanySearchController } from './company-search.controller';
import { CompanySearchService } from './company-search.service';
import { ReviewSearchController } from './review-search.controller';
import { ReviewSearchService } from './review-search.service';
import { ModerationQueueSearchService } from './moderation-queue-search.service';
import { opensearchClientProvider } from './opensearch-client.provider';

@Module({
  controllers: [CompanySearchController, ReviewSearchController],
  providers: [opensearchClientProvider, CompanySearchService, ReviewSearchService, ModerationQueueSearchService],
  exports: [CompanySearchService, ReviewSearchService, ModerationQueueSearchService],
})
export class SearchModule {}
