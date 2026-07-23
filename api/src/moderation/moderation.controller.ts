import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';

// Internal/admin surface — gated on a valid admin_session cookie (GitHub
// issue #159, Phase 18). Every route 401s without one.
@UseGuards(AdminJwtAuthGuard)
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
