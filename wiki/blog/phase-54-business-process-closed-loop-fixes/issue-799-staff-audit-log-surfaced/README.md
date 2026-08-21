# Phase 54, Issue #799 — staff_audit_log Written But Never Surfaced

*Part of Phase 54 — Business-Process Closed-Loop Fixes.
See `docs/ROADMAP.md` Phase 54.*

## The gap

`StaffAuditLogService.record()` (Phase 42) has written a row on every
`StaffAccountsService` mutation — account creation, role changes,
deactivation, reactivation, password resets — since staff accounts
themselves shipped. Nothing ever read it back. No API endpoint, no
admin page, nothing — the compliance trail existed in the database and
was completely invisible to the admins it was meant to serve. A real
audit log that nobody can actually audit isn't much better than no
audit log at all.

## The fix: one read endpoint, one admin page

```ts
// staff-accounts.service.ts
// Most recent first, capped — this is an operational/compliance view,
// not a paginated archive; a real "load more" is future scope if the
// cap ever matters in practice.
async listAuditLog(limit = 200): Promise<StaffAuditLogEntry[]> {
  const entries = await this.prisma.staffAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { username: true } },
      target: { select: { username: true } },
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    actorId: entry.actorId,
    actorUsername: entry.actor.username,
    targetId: entry.targetId,
    targetUsername: entry.target.username,
    // ... action, metadata, createdAt
  }));
}
```

```ts
// staff-accounts.controller.ts
@Get('audit-log')
@RequirePermission('admin:staff:manage') // same gate as every other staff-accounts route
listAuditLog() {
  return this.staffAccountsService.listAuditLog();
}
```

`actor`/`target` are both resolved to their real usernames via the
Prisma `include`, not left as bare ids the frontend would have to
resolve separately — a compliance log that shows opaque UUIDs instead of
"who did what to whom" isn't meaningfully more readable than the raw
table. A new `web/src/app/moderation/staff/audit-log/page.tsx` renders
the list, gated behind the same `admin:staff:manage` permission the API
enforces.

## Verification

A new e2e case in `staff-accounts.e2e-spec.ts` performs a real sequence
of staff mutations (create, role change, deactivate) through the actual
service methods, then asserts `GET /admin/staff/audit-log` returns them
in the right order with correct actor/target usernames resolved — not a
mocked read, a genuine round trip through `StaffAuditLogService.record()`
and back out through the new endpoint. A frontend spec covers the page
rendering the returned entries and gating correctly for a non-admin
staff role.
