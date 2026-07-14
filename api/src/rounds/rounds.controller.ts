import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RoundsService } from './rounds.service';
import { CreateRoundDto } from './dto/create-round.dto';

@Controller('processes/:processId/rounds')
export class RoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  @Post()
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: CreateRoundDto,
  ) {
    return this.roundsService.create(processId, dto);
  }

  @Get()
  findAllForProcess(@Param('processId', ParseUUIDPipe) processId: string) {
    return this.roundsService.findAllForProcess(processId);
  }
}
