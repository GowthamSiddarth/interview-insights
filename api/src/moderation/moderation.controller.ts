import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ModerationService } from './moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';
import { ModerationSearchQueryDto } from './dto/moderation-search-query.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AdminSessionPayload } from '../admin-auth/admin-auth.service';

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

  // GitHub issue #487 (Phase 36) — the claiming moderator is always the
  // authenticated caller (AdminJwtAuthGuard's own req.user), never a
  // client-supplied id, so a moderator can only ever claim/release on
  // their own behalf.
  @Post('queue/:id/claim')
  claim(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const moderator = req.user as AdminSessionPayload;
    return this.moderationService.claim(id, moderator.id);
  }

  @Post('queue/:id/release')
  release(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const moderator = req.user as AdminSessionPayload;
    return this.moderationService.release(id, moderator.id);
  }
}
