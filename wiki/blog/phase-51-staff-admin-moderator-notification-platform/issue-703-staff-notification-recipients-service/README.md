# Phase 51, Issue #703 — `StaffNotificationRecipientsService`

*Part of Phase 51 — Staff/Admin/Moderator Notification Platform.
See `docs/ROADMAP.md` Phase 51, `docs/DECISIONS.md` D104.*

## The gap

Two upcoming pieces of this phase both need the same thing —
"who should this broadcast reach" — resolved off the `Moderator` table
rather than a single event payload's own recipient field: #704's tiered
SLA escalation (warn every active moderator, escalate unclaimed
breaches to every active admin) and, had it needed one, any future
staff-wide announcement. Rather than let each build its own ad hoc
Prisma query, this issue extracts the resolution into one shared
service first.

## The fix: two methods, one role-hierarchy fact baked in

```ts
@Injectable()
export class StaffNotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Anyone who can actually claim/approve/reject a moderation queue
  // entry — both `moderator` and `admin` roles (api's own permissions.ts:
  // ADMIN_PERMISSIONS is a strict superset of MODERATOR_PERMISSIONS),
  // excluding `staff` (read-only, D99).
  async activeModeratorEmails(): Promise<string[]> {
    const rows = await this.prisma.moderator.findMany({
      where: { isActive: true, role: { in: ['moderator', 'admin'] } },
      select: { email: true },
    });
    return rows.map((r) => r.email);
  }

  // admin:staff:manage tier only.
  async activeAdminEmails(): Promise<string[]> {
    const rows = await this.prisma.moderator.findMany({
      where: { isActive: true, role: 'admin' },
      select: { email: true },
    });
    return rows.map((r) => r.email);
  }
}
```

The two methods encode two different notions of "staff" that already
exist implicitly in Phase 42's permission model but had never been
written down as a query before: `activeModeratorEmails()` is "anyone who
can act on a queue entry" (both `moderator` and `admin`, since an admin
inherits every moderator permission), while `activeAdminEmails()` is the
narrower `admin:staff:manage` tier alone. Both exclude `isActive: false`
accounts, so a deactivated moderator (#701's own `deactivated` event
target) never receives a broadcast meant for active staff.

`notification-service`'s own `Moderator` Prisma mirror (D75 pattern)
gained `role`/`isActive` columns to support the query — no migration
needed, since both columns already exist in the shared Postgres database
from `api`'s own Phase 42 migration; the mirror just hadn't needed to
read them until now.

This issue landed with the service written and unit-tested but not yet
wired into any consumer — that's #704 (tiered SLA escalation, the actual
consumer of `activeModeratorEmails()`/`activeAdminEmails()`) and #705
(staff.* event templates, which turn out not to need this service at
all: their emails are single-recipient, already carried on the event
payload's own `email` field).

## Verification

`staff-notification-recipients.service.spec.ts` against a real Postgres
connection (same "needs a real instance" standing as the rest of this
service's test suite): seeds a mix of active/inactive `staff`/`moderator`/
`admin` rows and asserts each method returns exactly the expected email
set, including the empty-array case when no rows match.
