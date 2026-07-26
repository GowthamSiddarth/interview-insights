import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';
import { ModerationSearchQueryDto } from './dto/moderation-search-query.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';

// Internal/admin surface — gated on a valid admin_session cookie (GitHub
// issue #159, Phase 18). Every route 401s without one. Base path is
// 'moderation' (not 'moderation/queue', GitHub issue #370) so the new
// fuzzy search route can live at GET /moderation/search, a sibling of
// /moderation/queue rather than nested under it — every existing route's
// own URL is unchanged, since each one's own path now carries the
// 'queue' segment directly.
@UseGuards(AdminJwtAuthGuard)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get('queue')
  listPending() {
    return this.moderationService.listPending();
  }

  @Get('search')
  search(@Query() query: ModerationSearchQueryDto) {
    return this.moderationService.search(query.q, query.category);
  }

  @Post('queue/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.approve(id, dto);
  }

  @Post('queue/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.reject(id, dto);
  }

  @Post('queue/:id/flag')
  flag(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationFlagDto) {
    return this.moderationService.flag(id, dto);
  }
}
