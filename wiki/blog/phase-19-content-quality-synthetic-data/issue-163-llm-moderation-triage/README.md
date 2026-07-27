# Phase 19, Issue #163 — LLM-Assisted Moderation Triage

*Part of Phase 19 — Content Quality & Synthetic Data. See `docs/ROADMAP.md`
Phase 19 and `docs/DECISIONS.md` D66.*

## Why this phase exists at all

Every fraud/spam signal this platform had before this issue was
deterministic: a rolling submission-count rate limit (D13, reframed by
D52), and trigram-similarity duplicate detection (issue #162, D64). Both
are cheap, fast, and explainable — but neither one reads a review for
*content*. Neither can tell a moderator "this text seems to name a
specific interviewer" or "this free text directly contradicts its own
5-out-of-5 difficulty score." That's a genuinely different kind of
signal, and it's the one this issue adds: a second opinion from an LLM,
sitting alongside the deterministic checks rather than replacing them.

## Key concept: advisory only, and that's not negotiable

CLAUDE.md's hard constraint #2 says every rating/review write starts
`pending` and goes through moderation before it's public — full stop, no
exception for suspicious ones. This issue's own scope, resolved before
any code was written, respects that completely: the LLM's output is
stored, shown to a moderator, and never — anywhere in the code — read
back to change `status`. There's no code path where a "concerning"
verdict rejects anything automatically, and there's no code path where a
clean verdict approves anything automatically. It's advisory in the
literal sense: advice a human is free to disagree with.

## Key concept: disabled by default is a design choice, not an accident

Every other external integration this project has (OpenSearch, Mailpit,
LocalStack) is something the app is written to assume is reachable — a
missing config value is a startup failure, matching the fact that these
are load-bearing dependencies in every environment this project runs in.
`ANTHROPIC_API_KEY` is different on purpose: there's no dev-only
placeholder value that could "work" the way `bcrypt("dev-only-admin-
password")` works for `ADMIN_PASSWORD_HASH` — a fake API key just fails
every request. So instead of a startup check, the Anthropic client
provider returns `null` when the key is unset, and the service treats
that as an ordinary, silent, expected state:

```ts
export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  useFactory: (): Anthropic | null => {
    if (!isAiModerationEnabled()) return null;
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  },
};
```

`computeAndStoreVerdict()` checks for `null` first and returns
immediately — no log, no error, nothing. This is why every unit test, e2e
test, and CI run in this project exercises this code path with zero
network calls: there's no `ANTHROPIC_API_KEY` configured anywhere in
those environments, by design, and the feature simply turns itself off.

## Key concept: in-process/synchronous now, on purpose

The issue's own text calls this out explicitly: built
in-process/synchronous *here*, deliberately, in contrast to Phase 32
(D53), which is already filed and waiting to port this same logic into
an async `review-analyzer` service once Phase 30's event bus exists.
That's not an oversight to fix later — it's the same "prove it simply
first, extract once a trigger fires" pattern this project already used
for OpenSearch back in Phase 5. Building the analysis logic and the
service-extraction plumbing at the same time would have made it hard to
tell which part of any bug belonged to which concern; this issue only
had to get the triage logic right, with nowhere else for a bug to hide.

## Key concept: never let a slow, unreliable external call become a
failed write

A real third-party API call is a fundamentally riskier thing to sit in a
write path than a local OpenSearch instance — it can refuse the request,
time out, or come back with text that doesn't parse as JSON. All of
`computeAndStoreVerdict()`'s body sits inside one try/catch:

```ts
async computeAndStoreVerdict(entityType, entityId): Promise<void> {
  if (!this.client) return; // feature disabled

  try {
    const content = await this.buildContent(entityType, entityId);
    if (!content) return; // entity already gone
    const verdict = await this.requestVerdict(content);
    if (!verdict) return; // refused, or unparseable
    await this.storeVerdict(entityType, entityId, verdict);
  } catch (err) {
    this.logger.error(/* ... */);
    // never rethrows — the write itself already succeeded
  }
}
```

A disabled feature, a `stop_reason: "refusal"`, a `JSON.parse` failure,
or a network error all converge on the exact same outcome:
`moderationVerdict` stays whatever it already was, usually `null`. This
is the same "never allowed to fail the operation it's attached to" shape
D16/D17 already established for OpenSearch indexing, applied to a call
with a meaningfully higher failure surface.

## System design approach

```
api/src/ai-moderation/
  ai-moderation.env.ts            # isAiModerationEnabled() / getAnthropicModel()
  anthropic-client.provider.ts     # Anthropic | null, based on ANTHROPIC_API_KEY
  ai-moderation.service.ts         # computeAndStoreVerdict(entityType, entityId)
  ai-moderation.module.ts
```

Wired into the four write paths that create or edit one of the three
moderated content types — `RoundRatingsService`/`RecruiterRatingsService`/
`OverallReviewsService`'s `create()` and `update()`, plus
`BulkProcessSubmissionService.create()` once per created rating/review —
called right after each write's own transaction commits, in the exact
same position `ModerationService.indexForSearch()` already occupies.

A new nullable `moderation_verdict` JSONB column was added to
`round_ratings`/`recruiter_ratings`/`overall_reviews`, mirroring
`Round.typeMetadata`'s own precedent for "structured, type-varying data
that doesn't need its own columns." The migration was hand-authored and
applied via `prisma migrate deploy` rather than `migrate dev` — the same
shadow-database workaround issue #162's own migration needed (D64),
since `migrate dev`'s shadow-DB replay still fails against this schema
for reasons unrelated to this issue.

Content sent to the model is rebuilt fresh from Postgres per entity type
— never trusted from whatever the caller already had in scope, the same
reasoning `indexForSearch`'s `buildIndexableEntry()` already follows.
Round ratings include the parent `Round`'s `roundType` and
`typeMetadata` (the round-type registry's already-human-readable
structured answers, per this issue's own scope note); recruiter ratings
and overall reviews send just their own fields, since neither has an
equivalent parent context to enrich with.

The model is asked for a strict JSON object
(`{"concerning": boolean, "reasons": string[], "summary": string}`)
via a plain system-prompt instruction, rather than using Structured
Outputs (`output_config.format`). That feature is gated to specific
model tiers (Fable 5, Opus 5, Opus 4.8, Sonnet 5, Haiku 4.5), and since
`ANTHROPIC_MODEL` is a deliberately open configuration knob — not
hardcoded, per the issue's own requirement — a plain prompt-and-parse
approach works regardless of which model an operator ultimately points
this at, with the same try/catch already handling a malformed response.

## What "surfaced to moderators, never auto-acted on" looks like

`ModerationService`'s existing `ModerationQueueEntity`/`enrichEntries()`
(built in Phase 29, issue #315) gained a `moderationVerdict` passthrough
field for the three entity types that can have one (never `company`,
which has no rateable content to triage). The moderation queue UI
renders it as a distinct box — "AI second opinion (advisory only)" —
visually separate from the deterministic fraud-check `flagReason` above
it, so a moderator can tell at a glance which signal is a hard,
deterministic rule (rate limiting, duplicate detection) and which is a
probabilistic second opinion they're free to weigh or ignore.

## Step-by-step: what actually got built and verified

1. **The migration** — one nullable JSONB column × three tables, applied
   to both dev and `interview_insights_test` via `migrate deploy`.
2. **The module** — env helpers, the nullable client provider, the
   service, wired into all four write-path modules and services.
3. **13 new/updated unit tests**: `ai-moderation.service.spec.ts` covers
   the disabled no-op, per-entity-type content building (including the
   round `typeMetadata` join), an entity that's already gone, a model
   refusal, an unparseable response, a network error, and a missing
   `ANTHROPIC_MODEL` — all converging on "no throw, no update call."
   Plus one new assertion in each of the three ratings/reviews service
   specs and the bulk-submission spec proving the call happens after
   commit, with the right entity type and id.
4. **`ModerationService`'s existing grouping test** extended with a real
   verdict object on one entity and an explicit `null` on a sibling
   entity in the same group, proving both render correctly.
5. **A new e2e assertion** in `bulk-process-submission.e2e-spec.ts`:
   after a full-tree submission, `moderationVerdict` is confirmed `null`
   on every created rating/review, directly against real Postgres — the
   disabled-by-default path proven end to end, not just unit-mocked.
6. **1 new web component test** (`moderation-page.spec.tsx`) covers both
   a rendered verdict box and the "no verdict yet" case rendering nothing
   at all, not an empty placeholder.
7. **Infra**: a new `anthropic-credentials` k8s Secret, provisioned
   imperatively by both `cd.yml` and `infra/scripts/bootstrap-kind.sh`
   from an optional `ANTHROPIC_API_KEY` — mirroring `admin-credentials`'s
   shape exactly, but never hard-failing when the value is empty, unlike
   the admin credential checks right next to it. `ANTHROPIC_MODEL`
   (non-secret) went into the plain `api-config` ConfigMap.

## What this enabled

Moderators reviewing the queue now get a second, independent read on
each piece of content — one that can catch things the deterministic
checks structurally can't, like a review that names a specific
interviewer or one whose free text flatly contradicts its own scores —
without that second opinion ever being trusted to make the actual call.
And because the feature is off by default everywhere no one has
deliberately turned it on, every test suite in this project, past and
future, exercises the "AI moderation disabled" path for free, with zero
network dependency and zero cost.
