import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { OverallReviewsService } from './overall-reviews.service';
import { CreateOverallReviewDto } from './dto/create-overall-review.dto';

// Singular resource path — a process has at most one overall review
// (UNIQUE(process_id), docs/DATA_MODEL.md), so this is /overall-review,
// not a /overall-reviews collection.
@Controller('processes/:processId/overall-review')
export class OverallReviewsController {
  constructor(private readonly overallReviewsService: OverallReviewsService) {}

  @Post()
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: CreateOverallReviewDto,
  ) {
    return this.overallReviewsService.create(processId, dto);
  }

  @Get()
  findApprovedForProcess(@Param('processId', ParseUUIDPipe) processId: string) {
    return this.overallReviewsService.findApprovedForProcess(processId);
  }
}
