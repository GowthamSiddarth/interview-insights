# Phase 29, Issue #315 — Moderation Queue: Full Round Content + Group by Submission

*Part of Phase 29 — Moderator Full Content Visibility & Submission
Consistency. See `docs/ROADMAP.md` Phase 29.*

## The gap this closed

`ModerationService.listPending()`'s round_rating enrichment already
fetched the full `Round` row (`include: { round: { include: { process:
{ include: { company: true } } } } }`) but only pulled `title` and
`roundType` out of it. `description`, `typeMetadata` (the round-type
registry's structured answers — arguably the most important content to
actually moderate, since it's what a candidate says was really asked),
and `scheduledDurationMinutes` were fetched and then silently dropped
before ever reaching `ModerationQueueEntity` or the moderator's screen.
A moderator saw the numeric scores and free text, but never what was
actually asked.

## The scope change that happened mid-implementation

The issue's original framing was narrow: "surface more round fields."
While implementing it, the project owner described a bigger, more
concrete problem directly, with a real example from live dev data — a
single submission with a round rating, two more round ratings on the
same coding round type, a recruiter rating, and an overall review
rendered as **five separate flat list items**, each repeating the exact
same "Amazon · SSE" header. Reviewing one candidate's one interview
loop meant scanning five visually-identical blocks for context that
never changed.

Rather than just adding fields to the existing flat shape, the fix
restructured the endpoint's whole information architecture: `GET
/moderation/queue` now groups every pending entity by its
`InterviewProcess` ("submission"). One collapsed row per submission,
expanding on click to reveal full per-entity detail — including this
issue's original ask — and the existing approve/reject/flag controls
per entry underneath.

## Key concept: grouping is a display concern, not a moderation-granularity change

It would have been easy to conflate "group entities visually" with
"moderate the group as one unit." These are different things. A real
submission can contain a mix of legitimate and suspicious content — in
fact the exact example that motivated this issue had 2 clean coding-
round ratings and 1 auto-flagged `rate_limit` (fraud-check) entry
inside the same submission. A moderator needs to approve the 2 good
ones and reject/flag the 1 suspicious one independently. So the
approve/reject/flag actions stay exactly as granular as before — per
entity, not per group. Only the *display* groups them; the underlying
moderation model is untouched.

## Key concept: reuse the existing per-entity-type failure isolation

`GET /moderation/queue` already had a real resilience property from an
earlier fix (D37): each entity type's enrichment query runs via
`Promise.allSettled`, so one type's transient Prisma failure degrades
only its own entries to `entity: null` rather than crashing the whole
endpoint for every caller. The new grouping logic had to preserve this
exactly — an entity whose enrichment failed still needs to land
*somewhere* in the response, or it silently vanishes from every
moderator's view. The fix: entries with no resolvable `processId` (the
D37 failure case) get a synthetic `unknown-${entry.id}` group key, so
they surface as their own standalone group instead of disappearing.

```ts
const groups = new Map<string, ModerationQueueGroup>();
for (const entry of enrichedEntries) {
  const key = entry.entity?.processId ?? `unknown-${entry.id}`;
  let group = groups.get(key);
  if (!group) {
    group = {
      processId: entry.entity?.processId ?? null,
      companyName: entry.entity?.companyName ?? 'Unknown',
      roleTitle: entry.entity?.roleTitle ?? 'Unknown',
      entries: [],
    };
    groups.set(key, group);
  }
  group.entries.push(entry);
}
return Array.from(groups.values());
```

`Map` insertion order keeps groups in the same createdAt-ascending
order the flat list always had — no explicit sort needed.

## Two kickoff questions resolved directly, not deferred

The issue's original body flagged two open questions. Both got
answered by looking at what the schema actually supports, not by
guessing:

- **Should `typeMetadata` render through a registry lookup, or as
  plain key/value pairs?** The registry's stored values (e.g. `["DFS",
  "BFS"]` for `problemAlgorithms`) are *already* the human-readable
  display strings — there is no ID-to-label translation layer anywhere
  in this schema. Building a lookup component would have been
  unnecessary work solving a problem that doesn't exist.
- **Does an interviewer display label belong here?** No — `Round.
  interviewerId` exists on the `Interviewer` Prisma model, but nothing
  in the codebase has ever written to it. `CreateRoundDto` has no
  interviewer-identifier field; `RoundsService.create()` never sets
  it. There's no data to enrich with, and building interviewer-identity
  capture from scratch would be a materially larger, separate feature
  — the closest analog is how much work Phase 14 needed just to give
  recruiters their own identity/label system.

## Step-by-step: what actually got built and verified

1. New `ModerationQueueEntity`/`ModerationQueueEntry`/
   `ModerationQueueGroup` interfaces replaced the previously untyped
   inline shapes in `moderation.service.ts`.
2. Every entity type's enrichment gained `processId` (needed for
   grouping); round_rating additionally gained `roundDescription`,
   `roundTypeMetadata`, `roundScheduledDurationMinutes`.
3. The flat `enrichedEntries` array became a `Map`-keyed grouping,
   returned as `ModerationQueueGroup[]`.
4. On `web`: `web/src/lib/api.ts` gained the matching types (plus,
   opportunistically, `roundTitle`'s `string | null` fix — see issue
   #316). `web/src/app/moderation/page.tsx` was restructured into one
   collapsed `Card` per group, expanding on click to reveal full
   detail via a new `RoundContentDetails` component.
5. 12 new/updated api unit tests (grouping by shared `processId`,
   separate processes producing separate groups, the D37
   transient-failure case reasserted per-group) — 294 api unit tests
   total. A new e2e test proved grouping against real Postgres; every
   other e2e spec reading `GET /moderation/queue` (10 files) was
   updated to flatten groups before searching for a specific entity,
   via a shared `test/support/moderation-queue.ts` helper. 10 new/
   updated web component tests covered the grouped/expandable UI.
6. Live-verified against the real `kind` cluster: created a company
   with one process carrying two round ratings (one with a real
   description/duration/typeMetadata) plus a recruiter rating,
   confirmed `GET /moderation/queue` returned exactly one group with
   all three entities nested under it and the round's full content
   reaching the response. Confirmed directly against the cluster's own
   pre-existing dev data: the original "Amazon · SSE" 5-row example
   collapsed to exactly one group of 5 entries.

## What this enabled

A moderator reviewing a multi-entity submission now sees it as one
thing to review, not five identical-looking distractions — and every
round rating's full submitted content (not just its scores) is finally
visible without a database query. This also directly motivated the
follow-on scope check that became issues #316 and #317: once the
grouping work touched the moderation queue's types and consistency
end to end, it was natural to ask what else in that surface didn't
quite line up.
