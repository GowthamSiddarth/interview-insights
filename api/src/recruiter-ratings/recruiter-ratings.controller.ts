import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
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
}
