# Phase 53, Issue #787 — Analytics Materialized Views Never Refreshed in Production

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53, `docs/DECISIONS.md` D15.*

## The gap

The three analytics materialized views
(`company_round_type_aggregates`, `company_recruiter_aggregates`,
`company_overall_aggregates`, from Phase 4) only reflect data as of
whatever `REFRESH MATERIALIZED VIEW` last ran. D15 originally left
*when* to refresh as an open question, deferred to "whichever endpoint
reads them" with refresh-on-read as the likely starting point. That
endpoint shipped — and never actually wired a refresh trigger at all.
The only `REFRESH MATERIALIZED VIEW` call in the entire repo lived
inside a manual dev/demo seeding script. In production, the analytics
dashboard had been frozen at whatever the last manual seed computed
since the app went live — every new approved rating silently invisible
to the numbers a company profile page shows.

Worse, D15's own "revisit when" premise had quietly stopped holding by
the time this was found: refresh-on-read looked simplest and correct in
Phase 4, but the analytics endpoint is public and unauthenticated —
refreshing `CONCURRENTLY` on every page view would mean unauthenticated
traffic directly drives real Postgres load, not the "simplest, correct"
choice it looked like when first deferred.

## The fix: refresh on approval, not on read

`ModerationService.review()` already knows exactly which entity type
just got approved — refreshing only *that* type's view, right there,
avoids the two wasted refreshes a blanket "refresh all three" would
cost on every single approval:

```ts
// moderation.service.ts
if (decision === 'approved') {
  await this.refreshAnalyticsView(entry.entityType);
}
```

```ts
private async refreshAnalyticsView(entityType: ModerationEntityType): Promise<void> {
  const viewName = this.analyticsViewFor(entityType);
  if (!viewName) return; // 'company' has no aggregate view of its own

  try {
    await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${viewName}"`);
  } catch (err) {
    this.logger.error(`Failed to refresh materialized view "${viewName}"`, err instanceof Error ? err.stack : err);
  }
}

private analyticsViewFor(entityType: ModerationEntityType): string | undefined {
  switch (entityType) {
    case 'round_rating': return 'company_round_type_aggregates';
    case 'recruiter_rating': return 'company_recruiter_aggregates';
    case 'overall_review': return 'company_overall_aggregates';
    case 'company': return undefined;
  }
}
```

`CONCURRENTLY` is what makes this safe to run in-band on every approval
without locking out concurrent readers — the unique index each view
already carries (from Phase 4's own original design) is a hard
prerequisite for `CONCURRENTLY` to work at all. Best-effort, after the
decision's own transaction has already committed — same D16/D17 shape
every other side effect in `review()` follows: a failed refresh must
never fail the moderation decision itself, and approval frequency is
admin/moderator-driven (naturally low, and never exploitable by public
traffic the way refresh-on-read would have been).

## Verification

Unit tests assert the refresh is triggered with the exact matching view
name for each of the three entity types on approval, never triggered on
reject/flag, never triggered for `company` (no aggregate view exists),
and that a refresh failure is caught and logged without propagating —
the moderation decision itself must still return successfully. A
real-Postgres e2e case drives an actual approval and confirms the
matching view's row count changes afterward, proving the `CONCURRENTLY`
refresh actually ran against a live database, not just that the SQL
string was constructed correctly.
