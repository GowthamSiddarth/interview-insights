import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ModerationService } from './moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';
import { ModerationSearchQueryDto } from './dto/moderation-search-query.dto';
import { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { AdminSessionPayload } from '../admin-auth/admin-auth.service';
import { PERMISSIONS } from '../admin-auth/permissions';
import { RequirePermission } from '../admin-auth/require-permission.decorator';
import { EscalatedEntryGuard } from './guards/escalated-entry.guard';

// Internal/admin surface — gated on a valid admin_session cookie (GitHub
// issue #159, Phase 18). Every route 401s without one. Base path is
// 'moderation' (not 'moderation/queue', GitHub issue #370) so the new
// fuzzy search route can live at GET /moderation/search, a sibling of
// /moderation/queue rather than nested under it — every existing route's
// own URL is unchanged, since each one's own path now carries the
// 'queue' segment directly.
//
// GitHub issue #588 (Phase 42, D99): PermissionsGuard added alongside
// AdminJwtAuthGuard — read routes require only the *_READ permission
// (staff and up), every actual moderation action requires the matching
// moderator-and-up permission. See api/src/admin-auth/permissions.ts for
// the full staff/moderator/admin permission-set map.
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // GitHub issue #522 (Phase 41) — entityType/companyId/status filters
  // apply as-given; claimState: 'mine' is resolved via the authenticated
  // caller (req.user), same pattern claim()/release() below already use —
  // never a client-supplied moderator id.
  @Get('queue')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_READ)
  listPending(@Query() query: ModerationQueueQueryDto, @Req() req: Request) {
    const moderator = req.user as AdminSessionPayload;
    return this.moderationService.listPending({
      entityType: query.entityType,
      companyId: query.companyId,
      claimState: query.claimState,
      status: query.status,
      moderatorId: query.claimState === 'mine' ? moderator.id : undefined,
    });
  }

  @Get('search')
  @RequirePermission(PERMISSIONS.MODERATION_SEARCH_READ)
  search(@Query() query: ModerationSearchQueryDto) {
    return this.moderationService.search(query.q, query.category);
  }

  // GitHub issue #689 (Phase 49, D104) — EscalatedEntryGuard runs after
  // PermissionsGuard's base moderator-and-up check: a plain moderator
  // still needs MODERATION_QUEUE_APPROVE/REJECT to reach this route at
  // all, but an escalated entry additionally requires the admin role
  // specifically. Not applied to flag() — flagging isn't a terminal
  // resolution, and #689's cap only gates who may resolve an escalated
  // entry, not who may claim/release/flag it.
  @Post('queue/:id/approve')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_APPROVE)
  @UseGuards(EscalatedEntryGuard)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.approve(id, dto);
  }

  @Post('queue/:id/reject')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_REJECT)
  @UseGuards(EscalatedEntryGuard)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationActionDto) {
    return this.moderationService.reject(id, dto);
  }

  @Post('queue/:id/flag')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_FLAG)
  flag(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationFlagDto) {
    return this.moderationService.flag(id, dto);
  }

  // GitHub issue #487 (Phase 36) — the claiming moderator is always the
  // authenticated caller (AdminJwtAuthGuard's own req.user), never a
  // client-supplied id, so a moderator can only ever claim/release on
  // their own behalf.
  @Post('queue/:id/claim')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_CLAIM)
  claim(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const moderator = req.user as AdminSessionPayload;
    return this.moderationService.claim(id, moderator.id);
  }

  @Post('queue/:id/release')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_RELEASE)
  release(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const moderator = req.user as AdminSessionPayload;
    return this.moderationService.release(id, moderator.id);
  }
}
