import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CompanyCreationThrottleGuard } from './company-creation-throttle.guard';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompanyReviewsQueryDto } from './dto/list-company-reviews-query.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // Session-gated + per-IP throttled: a company isn't owned by any one
  // candidate (no candidateId column, unlike the other write paths), so
  // this isn't attribution — it's closing an anonymous-write gap that
  // predated Phase 16's "sessions on the write path" pass entirely
  // (Company was never on that list because it has nothing to attribute).
  @Post()
  @UseGuards(CandidateJwtAuthGuard, CompanyCreationThrottleGuard)
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

  // GitHub issue #415 — same route-ordering reasoning as 'by-slug/:slug'
  // above: a literal segment declared before ':id' so it isn't swallowed
  // by that route and sent through ParseUUIDPipe as if 'top' were a
  // company id.
  @Get('top')
  findTop() {
    return this.companiesService.findTop();
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
