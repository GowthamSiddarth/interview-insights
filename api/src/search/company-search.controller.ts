import { Controller, Get, Query } from '@nestjs/common';
import { CompanySearchService } from './company-search.service';
import { SearchCompaniesQueryDto } from './dto/search-companies-query.dto';

@Controller('search/companies')
export class CompanySearchController {
  constructor(private readonly companySearchService: CompanySearchService) {}

  @Get()
  search(@Query() query: SearchCompaniesQueryDto) {
    return this.companySearchService.search(query.q, query.size, query.from);
  }
}
