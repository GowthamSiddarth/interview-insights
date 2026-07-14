import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InterviewProcessesService } from './interview-processes.service';
import { CreateInterviewProcessDto } from './dto/create-interview-process.dto';

@Controller()
export class InterviewProcessesController {
  constructor(private readonly interviewProcessesService: InterviewProcessesService) {}

  @Post('companies/:companyId/processes')
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateInterviewProcessDto,
  ) {
    return this.interviewProcessesService.create(companyId, dto);
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
