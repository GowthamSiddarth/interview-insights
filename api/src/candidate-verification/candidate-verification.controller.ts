import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CandidateVerificationService } from './candidate-verification.service';
import { VerifyCandidateDto } from './dto/verify-candidate.dto';

@Controller('candidates')
export class CandidateVerificationController {
  constructor(private readonly candidateVerificationService: CandidateVerificationService) {}

  @Post(':id/verification-token')
  issueToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.candidateVerificationService.issueToken(id);
  }

  @Post('verify')
  verify(@Body() dto: VerifyCandidateDto) {
    return this.candidateVerificationService.verify(dto.token);
  }
}
