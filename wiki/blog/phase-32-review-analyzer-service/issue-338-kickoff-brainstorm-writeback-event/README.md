# Phase 32, Issue #338 — Kickoff Brainstorm: How Does a Standalone Verdict Get Back Into `api`?

*Part of Phase 32 — Review Analyzer Service. See `docs/ROADMAP.md` Phase 32
and `docs/DECISIONS.md` D81.*

## The gap this closed

D66 built `AiModerationService` to run entirely in-process inside `api`:
compute an LLM verdict, write `moderationVerdict` straight onto the
entity row, and — once D71/Phase 39 shipped — call
`ModerationService.approveWithAudit()` in the same call stack for a
high-confidence verdict. Phase 32's whole point (per D53) is moving that
logic into its own out-of-cluster service, the same extraction Phase 31
already did for notifications. But notifications only ever *read* `api`'s
tables and send an email — nothing it does needs to change a row `api`
owns or trigger `api`'s own business logic. A verdict does both: it has
to land in a column on `api`'s database, and a high-confidence one has to
run `api`'s own auto-approval flow. A standalone process has no way to
call `ModerationService`'s methods directly, so before any code could be
written, three questions needed real answers: how the verdict gets back
into `api`'s data, how this new service relates to the
`FraudChecksService` checks that already run synchronously on every
write, and which LLM/API to keep using.

## Key concept: the write path is a stronger version of a rule this project already had

Phase 31 (D75) established "never write to a table you don't own" for
`notification-service`'s own read-only Prisma schema. This brainstorm
had to answer a harder version of that question: what happens when the
*decision that follows from* a row you don't own also isn't yours to
make? Two shapes were on the table for getting the verdict back to
`api`:

- **A shared write, or an internal HTTP callback.** `review-analyzer`
  either gets write access to `api`'s Postgres tables directly, or calls
  a new internal endpoint on `api` to hand the verdict over synchronously.
  Both were rejected. A direct write would be the first time this project
  ever let two services hold write access to the same table — and
  auto-approval would *still* need some way to call back into `api`'s
  `ModerationService`, so the direct-write option doesn't even avoid the
  callback problem, it just adds a second one. The HTTP-callback option
  on its own was rejected for a different reason: it's a synchronous
  service-to-service call, a pattern this project has deliberately
  avoided everywhere else since D53 committed to async, best-effort,
  after-commit plumbing as the whole shape of this extraction.
- **A new event, `moderation.<type>.verdict_computed.v1`.** `review-analyzer`
  consumes the existing `moderation.*.created.v1` topics — same as
  `notification-service` already does — computes the verdict exactly as
  `AiModerationService.requestVerdict()` did, and publishes the full
  verdict payload (including the confidence/`autoApprovalEligible` fields
  D71 added) as a new event. `api` gets its first-ever event *consumer*
  (everything up to this point has only ever been a producer, per D53)
  to apply it: write `moderationVerdict`, and call the same
  `approveWithAudit()` D71 already built when the verdict clears the
  auto-approval bar — unchanged, just triggered by a consumed event
  instead of an in-process method call.

The event-only shape won. It keeps `api` as the sole writer of its own
tables — `review-analyzer` never touches `moderation_queue` at all, so
issue #340's "review-analyzer never auto-approves or rejects anything
itself" is literally true, not just a naming convention — and it needs no
new synchronous coupling between services. The tradeoff accepted going
in: an extra event round-trip's worth of latency on auto-approval,
judged acceptable since D71's whole cutoff exists to tolerate exactly
that kind of async arrival already.

## Key concept: a second opinion never replaces the first one

`FraudChecksService`'s synchronous rate-limit/duplicate checks already
run inside the write-path transaction, producing `flagReason` on
suspicious content before a human ever sees it. The brainstorm confirmed
D53's original framing rather than changing it: `review-analyzer`'s
verdict is a secondary opinion that arrives later and sits alongside
`flagReason`, never something the write blocks on and never a
replacement for the synchronous checks. This kept the brainstorm's scope
narrow — the actual triage logic, LLM prompt, and moderator UI treatment
of a verdict were all already settled by D66/Phase 39; nothing about
this relationship needed to change to support the extraction.

## Step-by-step: what actually got resolved and written down

1. Confirmed the write-back mechanism above (event, not shared-DB write
   or HTTP callback) and worked through both rejected alternatives
   explicitly enough to write them down, not just the winning option —
   so a future reader hitting the same "how does a stateless worker
   change another service's data" question doesn't have to re-litigate
   ground already covered.
2. Confirmed `FraudChecksService`'s relationship to the new service is
   unchanged from how D53 already framed it.
3. Confirmed the LLM/API choice stays Anthropic's Claude API
   (`@anthropic-ai/sdk`), unchanged from D66, with `review-analyzer`
   getting its own LocalStack secrets bootstrap duplicating the
   credential rather than sharing `api`'s — the same precedent D73/D75
   already set for `notification-service`.
4. Wrote all three decisions up as `docs/DECISIONS.md` D81, updated
   `docs/ROADMAP.md`'s Phase 32 entry and `CLAUDE.md`'s current-status
   line. Docs-only change, no code touched — nothing to test.

## What this enabled

Issue #339 could build `review-analyzer`'s skeleton with a concrete
target already decided — subscribe to `*.created`, eventually publish
`*.verdict_computed` — instead of guessing at the write-back shape while
also standing up the service for the first time. Issue #340 is where
that event shape met the actual in-process code it was replacing; two
more gaps (removing the old synchronous call sites entirely, and where
the reconciliation sweep's escalation path belongs) surfaced only once
real implementation started, and were resolved as a same-day addendum to
this decision rather than reopening the brainstorm.
