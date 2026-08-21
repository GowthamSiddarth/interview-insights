# Phase 57, Issue #829 — Bulk Submission Transaction Has No Explicit Timeout Override

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, GitHub issue #251.*

## The gap

`BulkProcessSubmissionService.create()` — the endpoint backing the
draft wizard's "submit everything at once" flow — runs a fraud check
(a real, awaited Postgres query) for every round rating and every
recruiter interaction rating, sequentially, all inside one
`$transaction`. Sequential creation is deliberate, not an oversight: it's
what lets in-transaction duplicate-text detection catch two identical
`freeText` values within the same submission (the second one has to see
the first one already inserted). But that sequential-and-real-queries
shape means a candidate backfilling a large, real multi-round loop could
plausibly approach Prisma's 5-second default interactive-transaction
timeout — no hard cap exists on how many rounds/recruiter interactions
a single submission can contain.

## The fix: an explicit, generously-sized timeout

```ts
// GitHub issue #829 (Phase 57) — this transaction runs create()'s round and
// recruiter-interaction loops sequentially, each doing at least one fraud
// check (a real, awaited query — see this class's own top comment on why
// sequential creation is required for in-transaction duplicate-text
// detection to work at all), well within reach of Prisma's 5s default
// interactive-transaction timeout for a large-but-real submission (a
// candidate backfilling a whole multi-round loop after the fact isn't rare
// — see the wizard this endpoint backs). No hard cap exists on rounds/
// recruiterInteractions array length (CreateBulkProcessDto), so this is
// sized generously rather than tuned to today's typical loop size.
const BULK_SUBMISSION_TRANSACTION_TIMEOUT_MS = 20_000;

const process = await this.prisma.$transaction(async (tx) => {
  // ... round/recruiter-interaction loops
  return process;
}, { timeout: BULK_SUBMISSION_TRANSACTION_TIMEOUT_MS });
```

20 seconds, not a value tuned precisely against today's typical loop
size — the comment says so directly, since there's no schema-level
bound on how many rounds a submission can contain to tune against in
the first place. Generously sized on purpose: the cost of a timeout
that's too short is a legitimate, real submission failing outright; the
cost of one that's a little too long is a slower failure mode on the
rare pathological case, a clearly better tradeoff here.

## Verification

A unit test asserts `$transaction` is called with the exact
`{ timeout: 20_000 }` option — a simple, direct assertion that the
override is actually wired through, not just present as a constant
somewhere unused. No new integration test for the timeout actually
firing (deliberately — that would mean intentionally stalling a real
transaction for 20+ seconds in the test suite, a bad tradeoff for
marginal coverage of a value this generously sized).
