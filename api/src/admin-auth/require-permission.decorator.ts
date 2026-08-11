import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

// Applied per-route (GitHub issue #587, Phase 42, D99) alongside
// AdminJwtAuthGuard + PermissionsGuard — e.g.
// `@UseGuards(AdminJwtAuthGuard, PermissionsGuard) @RequirePermission(PERMISSIONS.MODERATION_QUEUE_APPROVE)`.
// A route with no @RequirePermission() is left to whatever guards it
// already has (PermissionsGuard allows it through unconditionally) — this
// decorator only ever narrows access further, never grants any.
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
