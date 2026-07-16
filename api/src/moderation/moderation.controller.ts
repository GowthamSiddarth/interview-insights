import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';

// Internal/admin surface — no auth yet (same gap as the rest of the API).
// Not meant for public consumption; there's no moderator UI in front of
// this yet either, see docs/ROADMAP.md Phase 3.
@Controller('moderation/queue')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  listPending() {
    return this.moderationService.listPending();
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.approve(id, dto);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.reject(id, dto);
  }

  @Post(':id/flag')
  flag(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationFlagDto) {
    return this.moderationService.flag(id, dto);
  }
}
