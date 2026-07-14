import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RoundRatingsService } from './round-ratings.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Controller('rounds/:roundId/ratings')
export class RoundRatingsController {
  constructor(private readonly roundRatingsService: RoundRatingsService) {}

  @Post()
  create(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: CreateRoundRatingDto,
  ) {
    return this.roundRatingsService.create(roundId, dto);
  }

  @Get()
  findApprovedForRound(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.roundRatingsService.findApprovedForRound(roundId);
  }
}
