import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { AdminSessionPayload } from '../admin-auth/admin-auth.service';
import { PERMISSIONS } from '../admin-auth/permissions';
import { RequirePermission } from '../admin-auth/require-permission.decorator';
import { CreateStaffAccountDto } from './dto/create-staff-account.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { StaffAccountsService } from './staff-accounts.service';

// Staff account management (GitHub issue #589, Phase 42, D99) — every
// route requires admin:staff:manage, the one permission never granted
// below the admin tier. @RequirePermission is applied per-route (not at
// the class level — PermissionsGuard only reads metadata off
// context.getHandler(), same as #588's ModerationController/
// AdminRoundTypeFieldOptionsController), even though every route here
// happens to need the same permission. Self-service password change lives
// on AdminAuthController instead (POST /auth/admin/change-password) since
// it only ever acts on the caller's own account and needs no permission
// gate.
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
@Controller('admin/staff')
export class StaffAccountsController {
  constructor(private readonly staffAccountsService: StaffAccountsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  list() {
    return this.staffAccountsService.list();
  }

  // Password is generated server-side (never client-supplied) and returned
  // exactly once in this response — same UX
  // infra/scripts/rotate-admin-credentials.sh already established for the
  // root account.
  @Post()
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  create(@Body() dto: CreateStaffAccountDto, @Req() req: Request) {
    const actor = req.user as AdminSessionPayload;
    return this.staffAccountsService.create(actor.id, dto);
  }

  @Patch(':id/role')
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffRoleDto,
    @Req() req: Request,
  ) {
    const actor = req.user as AdminSessionPayload;
    return this.staffAccountsService.updateRole(actor.id, id, dto.role);
  }

  @Post(':id/deactivate')
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = req.user as AdminSessionPayload;
    return this.staffAccountsService.deactivate(actor.id, id);
  }

  @Post(':id/reactivate')
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = req.user as AdminSessionPayload;
    return this.staffAccountsService.reactivate(actor.id, id);
  }

  // Admin-initiated reset (distinct from the self-service
  // POST /auth/admin/change-password) — no current-password confirmation
  // needed since the actor is a different, already-privileged account, not
  // the target themselves.
  @Post(':id/reset-password')
  @RequirePermission(PERMISSIONS.STAFF_MANAGE)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const actor = req.user as AdminSessionPayload;
    return this.staffAccountsService.resetPassword(actor.id, id);
  }
}
