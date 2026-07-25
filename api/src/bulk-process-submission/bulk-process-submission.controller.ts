import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { BulkProcessSubmissionService } from './bulk-process-submission.service';
import { CreateBulkProcessDto } from './dto/create-bulk-process.dto';

@Controller('companies/:companyId/processes/bulk')
export class BulkProcessSubmissionController {
  constructor(private readonly bulkProcessSubmissionService: BulkProcessSubmissionService) {}

  @Post()
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateBulkProcessDto,
  ) {
    return this.bulkProcessSubmissionService.create(companyId, candidateId, dto);
  }
}
