import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { RoundsService } from './rounds.service';
import { CreateRoundDto } from './dto/create-round.dto';

@Controller('processes/:processId/rounds')
export class RoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  // GitHub issue #775 — read stays public, only the write path needs a session.
  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRoundDto,
  ) {
    return this.roundsService.create(processId, candidateId, dto);
  }

  @Get()
  findAllForProcess(@Param('processId', ParseUUIDPipe) processId: string) {
    return this.roundsService.findAllForProcess(processId);
  }
}
