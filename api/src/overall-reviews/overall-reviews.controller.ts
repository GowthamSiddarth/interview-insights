import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { EditThrottleGuard } from '../common/edit-throttle.guard';
import { OverallReviewsService } from './overall-reviews.service';
import { CreateOverallReviewDto } from './dto/create-overall-review.dto';

// Singular resource path — a process has at most one overall review
// (UNIQUE(process_id), docs/DATA_MODEL.md), so this is /overall-review,
// not a /overall-reviews collection — update/delete (GitHub issue #150)
// need no separate :id for the same reason.
@Controller('processes/:processId/overall-review')
export class OverallReviewsController {
  constructor(private readonly overallReviewsService: OverallReviewsService) {}

  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateOverallReviewDto,
  ) {
    return this.overallReviewsService.create(processId, candidateId, dto);
  }

  @Get()
  findApprovedForProcess(@Param('processId', ParseUUIDPipe) processId: string) {
    return this.overallReviewsService.findApprovedForProcess(processId);
  }

  @Patch()
  @UseGuards(CandidateJwtAuthGuard, EditThrottleGuard)
  update(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateOverallReviewDto,
  ) {
    return this.overallReviewsService.update(processId, candidateId, dto);
  }

  @Delete()
  @UseGuards(CandidateJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentCandidateId() candidateId: string,
  ) {
    return this.overallReviewsService.remove(processId, candidateId);
  }
}
