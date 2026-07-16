# Phase 3, Issue #2 — Fraud Checks

*Part of Phase 3 — Trust & moderation. See `docs/ROADMAP.md` Phase 3,
`docs/DECISIONS.md` D13.*

## Why this came first

Issue #1 built the mechanism to move a rating from `pending` to
`approved`, but gave a human moderator no signal about *which* pending
entries deserve extra scrutiny. Without that signal, moderation doesn't
scale past a handful of ratings a day — issue #2's job was to add cheap,
automatic signals a moderator can act on, without ever taking the
decision out of their hands.

## Key concepts

- **Flag, never reject.** This is the single most important design
  decision in this issue, stated as a hard rule in the code's own
  comments: a rating that trips a fraud check is still created exactly
  like any other rating — `pending`, visible to moderation, nothing more.
  The *only* effect of tripping a check is a `flagReason` attached to its
  `moderation_queue` entry.
- **Why not reject outright?** A hard block on suspicious-looking activity
  risks blocking a legitimate candidate with no recourse — and a false
  positive that silently blocks a real candidate does more damage to
  trust than a false negative that lets one bad rating through to a human
  moderator. Concretely: a candidate interviewing at multiple companies
  the same week will naturally submit several ratings in a short window
  (a plausible rate-limit trip that isn't fraud), and two different
  candidates independently writing a short, generic review of the same
  round ("It was fine, standard LeetCode question.") will naturally
  produce near-identical text (a plausible duplicate-detection trip
  that isn't fraud either). Both are exactly the false-positive shape a
  purely automated reject would get wrong — routing them to a human
  instead is what keeps the system trustworthy in the cases automation
  can't reliably distinguish.
- **An "honest MVP," not a scalable solution — and that's a deliberate,
  named tradeoff, not a shortcut taken by accident.** Duplicate detection
  is a full-table scan-and-compare in application code, not backed by
  any index. This is explicitly fine at today's data volume and
  explicitly not something that scales — `docs/DECISIONS.md` D13 names
  the exact upgrade path (a Postgres trigram index, or moving the check
  into the OpenSearch layer once Phase 5 builds it) and the exact trigger
  for taking it ("when real volume makes the full-table scan slow"). This
  is the same "ship the honest, simple version now; name the real
  limitation; write down what would trigger revisiting it" pattern as D9 —
  a reusable habit for any project deciding between "correct and simple
  today" versus "complex and future-proof before there's evidence it's
  needed."

## Core technologies

- **Two independent, composable checks**, each a plain async method on
  `FraudChecksService`, both accepting the same optional Prisma
  transaction parameter pattern established in issue #1 (so they can run
  as part of the same atomic write).
- **A rolling time-window count** (`checkRateLimit`) — no external rate
  limiter (Redis, a sliding-window algorithm library) needed; a `COUNT(*)
  WHERE created_at >= window_start` query against the same Postgres
  already being written to is sufficient at this scale, and avoids adding
  Redis before Phase 8e's actual trigger for it fires.
- **Text normalization + exact-match comparison**
  (`checkDuplicateFreeText`) — `trim().toLowerCase().replace(/\s+/g, ' ')`
  before comparing, so cosmetic differences (extra whitespace, casing)
  don't defeat a genuinely duplicate submission, while still stopping
  short of any fuzzy/near-duplicate matching (a much harder, higher-
  false-positive-risk problem, explicitly deferred).

## System design approach

Both checks share one shape worth internalizing as a reusable pattern for
any "detect something suspicious without blocking the user" feature:
**a check is a pure query against existing data, returning a boolean or a
reason — never a check that mutates anything or throws.** This is what
makes `detectFlagReason()` safe to call unconditionally on every write,
with a simple, deterministic tie-break when more than one check trips:

```typescript
async detectFlagReason(candidateId, freeText, tx) {
  if (await this.checkRateLimit(candidateId, tx)) return 'rate_limit';
  if (await this.checkDuplicateFreeText(freeText, tx)) return 'duplicate';
  return undefined;
}
```

Only one `flagReason` fits per `moderation_queue` row (it's a single
nullable enum column, not a list) — so if a submission trips both checks,
`rate_limit` wins. The ordering is arbitrary but deterministic, which is
the actually important property: a moderator seeing `rate_limit` can
trust that means "this candidate is rating unusually fast," even though a
duplicate-text trip might also be true underneath — good enough for a
human decision-maker, and simpler than modeling multiple simultaneous
flag reasons before there's any evidence that distinction matters to a
real moderator.

The rate-limit check itself is a direct, unindexed count query:

```typescript
async checkRateLimit(candidateId, tx) {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS); // 24h
  const count = await tx.roundRating.count({
    where: { candidateId, createdAt: { gte: windowStart } },
  });
  return count >= RATE_LIMIT_MAX_RATINGS; // 3
}
```

Both `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_RATINGS` are called out in
a code comment as placeholders — "not tuned against real data yet," the
same framing as the shrinkage formula's `k` constant in `docs/DATA_MODEL.md`
— a reminder that a reasonable-sounding starting constant and a *tuned*
constant are different things, and pretending otherwise before real data
exists would be false precision.

## Step-by-step: what actually got built

1. **Created the `fraud-checks/` module** with a single
   `FraudChecksService`, no controller — these checks are never called
   directly over HTTP, only from inside `RoundRatingsService.create()`.
2. **Built `checkRateLimit`** — count a candidate's ratings in the
   trailing 24h window, trip at 3 or more.
3. **Built `checkDuplicateFreeText`** — normalize the incoming
   `free_text`, then compare it against every existing rating's
   normalized `free_text` via a full-table fetch-and-compare in
   application code (not a SQL `WHERE` clause doing the normalization,
   since Postgres would need a functional index to do that efficiently —
   deliberately not built yet, per the D13 tradeoff above).
4. **Built `detectFlagReason`**, combining both checks with the
   rate-limit-wins tie-break.
5. **Wired it into `RoundRatingsService.create()`**, inside the same
   transaction issue #1 already opened for the rating write + moderation
   enqueue — `detectFlagReason` runs against *pre-existing* rows only
   (queried before the new rating is inserted in the same transaction),
   so a rating can never be flagged as a duplicate of itself.
6. **Wrote 7 unit tests** covering both checks' boundary conditions
   (exactly at the rate limit, one under it; identical text after
   normalization differences, genuinely distinct text).
7. **Wrote `fraud-checks.e2e-spec.ts`** against a real Postgres, proving
   both checks trip correctly and — critically — that a write is *never*
   rejected even when a check trips; the rating still returns `201` with
   `status: 'pending'`, same as any other.
8. **Found and fixed a real bug one issue later** (documented in issue
   #3's own history, not this one): this e2e suite originally used fixed
   literal `free_text` strings, which collided with leftover rows from
   earlier runs against the same persistent Docker Postgres volume and
   made the "distinct text isn't flagged" assertion flaky. Fixed by
   generating unique text per run — the exact same discipline Phase 2.2's
   testing-strategy post established for slugs and emails, now proven to
   matter for free-text content too.

## What this enabled

Every rating written from this point forward carries a `flagReason`
signal into moderation automatically, with zero risk of a legitimate
candidate ever being silently blocked. The "flag, never reject" principle
established here becomes the load-bearing precedent for how this project
treats *every* future automated-suspicion signal — the alternative (an
automated hard block) was never seriously reconsidered in any later
phase, precisely because this issue worked through the tradeoff
explicitly and named it in `docs/DECISIONS.md` rather than leaving it
implicit.
