import { StaffRole } from '@prisma/client';

// Permission-set model (GitHub issue #587, Phase 42, D99) — chosen over
// three hardcoded flat role checks (`if (role === 'admin' || ...)`)
// scattered per controller so a future nuance (e.g. a moderator without PII
// visibility) composes from a new permission instead of forcing a new role
// or a rewrite of every guard. Each role's set is a strict superset of the
// role below it, matching the admin > moderator > staff hierarchy.
export const PERMISSIONS = {
  MODERATION_QUEUE_READ: 'moderation:queue:read',
  MODERATION_SEARCH_READ: 'moderation:search:read',
  MODERATION_ANALYTICS_READ: 'moderation:analytics:read',
  MODERATION_QUEUE_APPROVE: 'moderation:queue:approve',
  MODERATION_QUEUE_REJECT: 'moderation:queue:reject',
  MODERATION_QUEUE_FLAG: 'moderation:queue:flag',
  MODERATION_QUEUE_CLAIM: 'moderation:queue:claim',
  MODERATION_QUEUE_RELEASE: 'moderation:queue:release',
  ROUND_TYPES_READ: 'admin:round_types:read',
  ROUND_TYPES_WRITE: 'admin:round_types:write',
  STAFF_MANAGE: 'admin:staff:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// STAFF (D99): read-only access to the moderation queue, search, round-type
// registry, and moderator/SLA analytics dashboards — no claim/approve/
// reject/flag/write permissions of any kind.
const STAFF_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.MODERATION_QUEUE_READ,
  PERMISSIONS.MODERATION_SEARCH_READ,
  PERMISSIONS.MODERATION_ANALYTICS_READ,
  PERMISSIONS.ROUND_TYPES_READ,
];

// MODERATOR: everything STAFF has, plus the actual moderation actions and
// round-type field-option curation this project's one shared admin
// credential already performed pre-Phase-42.
const MODERATOR_PERMISSIONS: readonly Permission[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.MODERATION_QUEUE_APPROVE,
  PERMISSIONS.MODERATION_QUEUE_REJECT,
  PERMISSIONS.MODERATION_QUEUE_FLAG,
  PERMISSIONS.MODERATION_QUEUE_CLAIM,
  PERMISSIONS.MODERATION_QUEUE_RELEASE,
  PERMISSIONS.ROUND_TYPES_WRITE,
];

// ADMIN: everything MODERATOR has, plus staff account management (#589) —
// the one permission that is never delegated below the root tier.
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MODERATOR_PERMISSIONS,
  PERMISSIONS.STAFF_MANAGE,
];

export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  staff: STAFF_PERMISSIONS,
  moderator: MODERATOR_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
};

export function roleHasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
