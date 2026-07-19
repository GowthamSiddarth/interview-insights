import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RecruiterInteractionsService } from './recruiter-interactions.service';
import { CreateRecruiterInteractionDto } from './dto/create-recruiter-interaction.dto';

@Controller('processes/:processId/recruiter-interactions')
export class RecruiterInteractionsController {
  constructor(private readonly recruiterInteractionsService: RecruiterInteractionsService) {}

  @Post()
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: CreateRecruiterInteractionDto,
  ) {
    return this.recruiterInteractionsService.create(processId, dto);
  }
}