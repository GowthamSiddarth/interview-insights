# Phase 36, Issue #490 — Queue UI: Surface SLA Deadline and Breach State

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

`slaDeadline` had been on the wire since #486/#487, but nothing on the
moderation queue page rendered it — a moderator had no way to see how
much time was left on an entry, or that one had already breached,
without cross-referencing a raw timestamp by hand. This issue adds a
per-entry time-remaining/overdue indicator.

## Key concept: a pure function, tested without faking the clock

`formatSlaStatus()` takes `now` as an explicit parameter rather than
reading `Date.now()` internally:

```ts
export function formatSlaStatus(slaDeadline: string, now: Date = new Date()): SlaStatus {
  const diffMs = new Date(slaDeadline).getTime() - now.getTime();
  if (diffMs <= 0) return { label: `Overdue by ${humanizeDurationMs(-diffMs)}`, overdue: true };
  return { label: `Due in ${humanizeDurationMs(diffMs)}`, overdue: false };
}
```

Every test passes a fixed `now` directly — no `jest.useFakeTimers()`,
no system-clock mocking, just plain input/output assertions covering
the minutes/hours/days boundaries and the exact-deadline-instant edge
case (floored to "Overdue by 1m" rather than "0m," which would read as
not-yet-overdue).

## Key concept: no live-ticking clock, and that's a deliberate scope boundary

The badge is computed once, at render time. A moderator who leaves the
queue page open for hours sees a slightly stale "Due in 3h" until the
next re-render — triggered by an action (approve/reject/claim) or a
reload, not a `setInterval` ticking the label down in real time. This
matches every other value already on this page (submission timestamps,
claim state) — nothing else live-updates either, and adding a ticking
clock for just this one field would be new complexity the issue never
asked for.

## Key concept: per entry, not per submission group

The queue groups entries by submission (Phase 29, #315) — a group stays
collapsed until a moderator expands it. The SLA badge renders per
*entry*, inside that expanded detail, exactly matching the issue's own
wording ("per entry") rather than trying to summarize a group's overall
urgency on its collapsed header (e.g. "earliest deadline in this
group"), which nobody asked for and would need its own design pass.

## Step-by-step: what actually got built and verified

1. New `formatSlaStatus()` (`web/src/lib/format-sla-status.ts`) —
   minutes under an hour, hours under a day, days at 24h+, red-flagged
   `overdue: boolean`.
2. New `SlaBadge` component: red "Overdue by X" past deadline, neutral
   gray "Due in X" otherwise.
3. Wired into both places an entry renders — the flat search-results
   view and each entry inside an expanded submission group — right
   next to the existing category/claim badges.
4. 6 new unit tests for `formatSlaStatus()`, 2 new page-level tests
   (an overdue badge renders on expand using the existing, deliberately
   past-dated test fixtures; a future-dated entry shows "Due in," not
   overdue) — full web suite (171/171) green, `tsc`/`eslint` clean.

## What this enabled

This is the last piece of the moderator-facing surface Phase 36 set
out to build — SLA deadlines (#486), manual claim (#487), automatic
breach detection (#488) and its email (#489) all converge here: a
moderator scanning the queue now sees exactly what's urgent without
having to open every entry or wait for an email that, per D80, only
ever reaches a claimed entry's own claimant.
