# Phase 57, Issue #823 — GET /moderation/queue Has No Pagination

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, GitHub issue #315.*

## The gap

`ModerationService.listPending()` loaded every unreviewed
`moderation_queue` entry unconditionally before grouping them by
`InterviewProcess` (#315's grouping fix) — no cap, no pagination, the
same unbounded shape #822 found on `GET /companies`. Compounding here:
each entry also gets enriched with its underlying entity's full content
before grouping, so the per-row cost of an unbounded queue scan is
considerably higher than a plain company listing.

## The fix: a bounded cap, not full pagination — and a documented reason why not

```ts
// GitHub issue #823 (Phase 57) — "all pending, no filter" was fully
// unbounded, compounding with the per-row enrichment work below.
// Capped, not fully paginated: entries are grouped by process after
// this query (issue #315), and the frontend queue view has no
// pagination UI of its own to consume a real page boundary yet — a
// bounded take is the proportionate fix until either changes. Ordered
// by slaDeadline (most urgent first) either way, so a cap still
// surfaces the entries that matter most; a same-submission's rounds
// are created together and so share a near-identical slaDeadline, so
// a group split across this boundary is a low-probability edge case,
// not a designed guarantee.
const QUEUE_ENTRY_CAP = 500;
const entries = await this.prisma.moderationQueueEntry.findMany({
  where,
  orderBy: { slaDeadline: 'asc' },
  take: QUEUE_ENTRY_CAP,
  include: { claimedBy: { select: { id: true, username: true } } },
});
```

Full `page`/`pageSize` pagination (like #822's fix) wasn't the right
call here, and the comment says so explicitly rather than leaving that
judgment implicit: the queue's own by-process grouping means a
naive row-level `LIMIT`/`OFFSET` risks splitting one submission's
rounds across a page boundary — the exact bug #347/#315 already fixed
once. A correct paginated fix needs either a window-function query or a
precomputed view (the shape #824 later built for the company-reviews
endpoint), real separate work — not justified yet since the frontend
queue view has no pagination UI to consume a page boundary with in the
first place. A bounded cap, ordered by urgency, is the proportionate
fix for today's actual constraint.

## Verification

A unit test asserts the exact `take: 500` argument reaches
`findMany()`, plus a dedicated test confirming the cap actually bounds
the result — more than 500 pending entries in the mock, fewer than 500
returned. Existing grouping/ordering tests continued to pass unchanged,
confirming the cap didn't disturb the by-process grouping or
urgency-first ordering it sits alongside.
