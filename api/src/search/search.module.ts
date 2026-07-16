import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { CompanySearchService } from './company-search.service';
import { opensearchClientProvider } from './opensearch-client.provider';

@Module({
  controllers: [SearchController],
  providers: [opensearchClientProvider, CompanySearchService],
  exports: [CompanySearchService],
})
export class SearchModule {}
