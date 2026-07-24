import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { RoundRatingsService } from './round-ratings.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Controller('rounds/:roundId/ratings')
export class RoundRatingsController {
  constructor(private readonly roundRatingsService: RoundRatingsService) {}

  // Read stays public (GitHub issue #146 is about the write path only) —
  // only this route requires a session.
  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRoundRatingDto,
  ) {
    return this.roundRatingsService.create(roundId, candidateId, dto);
  }

  @Get()
  findApprovedForRound(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.roundRatingsService.findApprovedForRound(roundId);
  }
}
