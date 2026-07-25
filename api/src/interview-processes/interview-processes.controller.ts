import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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

  // GitHub issue #260 — only ever deletes a process with nothing in it;
  // see the service for why this is narrower than issue #150's own
  // deliberate "never structural entities" scope.
  @Delete('processes/:id')
  @UseGuards(CandidateJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentCandidateId() candidateId: string) {
    return this.interviewProcessesService.remove(id, candidateId);
  }
}
