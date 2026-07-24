import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { InterviewProcessesService } from './interview-processes.service';
import { CreateInterviewProcessDto } from './dto/create-interview-process.dto';

@Controller()
export class InterviewProcessesController {
  constructor(private readonly interviewProcessesService: InterviewProcessesService) {}

  @Post('companies/:companyId/processes')
  @UseGuards(CandidateJwtAuthGuard)
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @CurrentCandidateId() candidateId: string,
    @Body() dto: CreateInterviewProcessDto,
  ) {
    return this.interviewProcessesService.create(companyId, candidateId, dto);
  }

  @Get('companies/:companyId/processes')
  findAllForCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.interviewProcessesService.findAllForCompany(companyId);
  }

  @Get('processes/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.interviewProcessesService.findOne(id);
  }
}
