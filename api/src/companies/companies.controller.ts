import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompanyReviewsQueryDto } from './dto/list-company-reviews-query.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Get()
  findAll() {
    return this.companiesService.findAll();
  }

  // Two-segment path, so it can't collide with the single-segment ':id'
  // route below.
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.companiesService.findBySlug(slug);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.findOne(id);
  }

  @Get(':id/reviews')
  findApprovedReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListCompanyReviewsQueryDto,
  ) {
    return this.companiesService.findApprovedReviews(id, query.page ?? 1, query.pageSize ?? 10);
  }
}
