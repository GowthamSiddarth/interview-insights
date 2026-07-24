import { Controller, Get, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('submissions')
  @UseGuards(CandidateJwtAuthGuard)
  findMySubmissions(@CurrentCandidateId() candidateId: string) {
    return this.meService.findMySubmissions(candidateId);
  }
}
