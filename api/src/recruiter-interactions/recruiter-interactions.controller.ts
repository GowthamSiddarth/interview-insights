import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { RecruiterInteractionsService } from './recruiter-interactions.service';
import { CreateRecruiterInteractionDto } from './dto/create-recruiter-interaction.dto';

@Controller('processes/:processId/recruiter-interactions')
export class RecruiterInteractionsController {
  constructor(private readonly recruiterInteractionsService: RecruiterInteractionsService) {}

  // GitHub issue #776 — same guard + ownership pattern as rounds (#775).
  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateRecruiterInteractionDto,
  ) {
    return this.recruiterInteractionsService.create(processId, candidateId, dto);
  }
}