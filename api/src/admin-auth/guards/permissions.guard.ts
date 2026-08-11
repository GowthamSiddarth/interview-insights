import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminSessionPayload } from '../admin-auth.service';
import { Permission, roleHasPermission } from '../permissions';
import { PERMISSION_METADATA_KEY } from '../require-permission.decorator';

// Must run after AdminJwtAuthGuard in the same @UseGuards() array — reads
// req.user, which only AdminJwtAuthGuard populates (GitHub issue #587,
// Phase 42, D99). A route with no @RequirePermission() metadata is allowed
// through unconditionally: this guard only narrows what AdminJwtAuthGuard
// already granted, it never grants access on its own.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission | undefined>(
      PERMISSION_METADATA_KEY,
      context.getHandler(),
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const { role } = req.user as AdminSessionPayload;

    if (!roleHasPermission(role, required)) {
      throw new ForbiddenException(`Missing required permission: ${required}`);
    }
    return true;
  }
}
