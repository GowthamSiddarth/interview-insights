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
import { RoundRatingsService } from './round-ratings.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Controller('rounds/:roundId/ratings')
export class RoundRatingsController {
  constructor(private readonly roundRatingsService: RoundRatingsService) {}

  // Read stays public (GitHub issue #146 is about the write path only) —
  // only these routes require a session.
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

  // GitHub issue #150. EditThrottleGuard must run after
  // CandidateJwtAuthGuard so req.user.candidateId is already populated.
  @Patch(':id')
  @UseGuards(CandidateJwtAuthGuard, EditThrottleGuard)
  update(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRoundRatingDto,
  ) {
    return this.roundRatingsService.update(roundId, id, candidateId, dto);
  }

  @Delete(':id')
  @UseGuards(CandidateJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCandidateId() candidateId: string,
  ) {
    return this.roundRatingsService.remove(roundId, id, candidateId);
  }
}
