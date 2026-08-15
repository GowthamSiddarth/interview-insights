import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { EditThrottleGuard } from '../common/edit-throttle.guard';
import { CompanyCreationThrottleGuard } from './company-creation-throttle.guard';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompanyReviewsQueryDto } from './dto/list-company-reviews-query.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // Session-gated + per-IP throttled — was purely an anonymous-write gap
  // closer predating Phase 16's "sessions on the write path" pass (a
  // company wasn't owned by anyone, so there was nothing to attribute).
  // GitHub issue #696 (Phase 50, D104) now attributes it too, same
  // CurrentCandidateId-from-session convention (#146) every other write
  // path already uses.
  @Post()
  @UseGuards(CandidateJwtAuthGuard, CompanyCreationThrottleGuard)
  create(@Body() dto: CreateCompanyDto, @CurrentCandidateId() candidateId: string) {
    return this.companiesService.create(dto, candidateId);
  }

  // GitHub issue #697 (Phase 50, D104). EditThrottleGuard must run after
  // CandidateJwtAuthGuard so req.user.candidateId is already populated —
  // same guard-ordering pattern RoundRatingsController's own PATCH route
  // already uses.
  @Patch(':id')
  @UseGuards(CandidateJwtAuthGuard, EditThrottleGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCompanyDto,
    @CurrentCandidateId() candidateId: string,
  ) {
    return this.companiesService.update(id, candidateId, dto);
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
