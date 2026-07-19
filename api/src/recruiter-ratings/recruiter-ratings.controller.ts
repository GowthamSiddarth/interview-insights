import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { CreateRecruiterRatingDto } from './dto/create-recruiter-rating.dto';

@Controller('recruiter-interactions/:recruiterInteractionId/ratings')
export class RecruiterRatingsController {
  constructor(private readonly recruiterRatingsService: RecruiterRatingsService) {}

  @Post()
  create(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
    @Body() dto: CreateRecruiterRatingDto,
  ) {
    return this.recruiterRatingsService.create(recruiterInteractionId, dto);
  }

  @Get()
  findApprovedForInteraction(
    @Param('recruiterInteractionId', ParseUUIDPipe) recruiterInteractionId: string,
  ) {
    return this.recruiterRatingsService.findApprovedForInteraction(recruiterInteractionId);
  }
}
