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
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { CreateRecruiterRatingDto } from './dto/create-recruiter-rating.dto';

@Controller('recruiter-interactions/:recruiterInteractionId/ratings')
export class RecruiterRatingsController {
  constructor(private readonly recruiterRatingsService: RecruiterRatingsService) {}

  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRecruiterRatingDto,
  ) {
    return this.recruiterRatingsService.create(recruiterInteractionId, candidateId, dto);
  }

  @Get()
  findApprovedForInteraction(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
  ) {
    return this.recruiterRatingsService.findApprovedForInteraction(recruiterInteractionId);
  }

  // GitHub issue #150.
  @Patch(':id')
  @UseGuards(CandidateJwtAuthGuard, EditThrottleGuard)
  update(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRecruiterRatingDto,
  ) {
    return this.recruiterRatingsService.update(recruiterInteractionId, id, candidateId, dto);
  }

  @Delete(':id')
  @UseGuards(CandidateJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCandidateId() candidateId: string,
  ) {
    return this.recruiterRatingsService.remove(recruiterInteractionId, id, candidateId);
  }
}
