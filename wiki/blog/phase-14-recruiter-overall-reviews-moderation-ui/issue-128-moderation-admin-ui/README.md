# Phase 14, Issue #128 — Moderation Admin UI

*Part of Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI.
Depends on issues #125 and #126. See `docs/ROADMAP.md` Phase 14.*

## Why this came last (of the feature issues)

Since Phase 3, approving a rating meant crafting a curl command against
`POST /moderation/queue/:id/approve`. Tolerable for one entity type; a
compounding liability once issues #125/#126 made it three. The planning
pass bundled this issue into the phase for exactly that reason — adding
write paths without a humane way to review them would have made the
moderation story *worse*, not better. It ran last so it could be
exercised against all three entity types for real.

## Key concept: pending content is unreadable everywhere — so the queue must carry it

Every public read endpoint in this app filters to `status: 'approved'`,
deliberately (hard constraint #2). Which means a moderation UI cannot
fetch what it's moderating: there is no endpoint anywhere that returns
a pending rating's contents, and adding one would poke a hole in the
exact wall moderation exists to be. The resolution: `GET
/moderation/queue` — already an internal/admin surface — now enriches
each entry server-side with its entity's own fields plus display
context (company name, role title, round title/type, the generated
recruiter label). The UI needs no second lookup because a second lookup
was never going to be possible.

Implementation shape matters at this altitude: the enrichment is one
`findMany` **per entity type per page** (three queries, batched over
`id IN (...)`), never one per entry — the same "don't do N+1 by
accident" discipline the aggregation views established in Phase 4.

## Key concept: the privacy boundary is the API, not the page

Hard constraint #1 says real interviewer/recruiter identities never go
public. It would have been easy to include the whole Prisma object in
the enrichment and let the page render only the polite fields — and it
would have been wrong: the raw `internal_identifier_hash` would sit in
every response body, one `View Source` away. Instead the service maps
each entity to an explicit shape (scores, text, company/role context,
`displayLabel` only), a unit test asserts the hash string never
appears anywhere in the serialized response, and `candidateId` is
omitted too — moderating *content* doesn't require knowing who wrote
it. The Playwright verification repeats the check from the outside:
after the page renders all three entity types, it asserts the seeded
raw recruiter identifier appears nowhere in the DOM.

## System design approach

One new page, `web/src/app/moderation/page.tsx`, linked from the shared
NavBar (an unauthenticated internal page — the same trust model as the
API endpoints it fronts; gating it behind real auth is Phase 8's
concern, per the issue's explicit scope):

- Pending entries render as cards — entity type, submission time, the
  enriched context, and the entity's text as a blockquote.
- **Approve / Reject / Flag** buttons per card, calling the Phase 3
  endpoints unchanged. Flag gets a per-entry reason selector
  (`manual_report` default); an optional "moderator name" field at the
  top flows into `reviewedBy` on every action.
- A fraud-check `flagReason` (Phase 3 issue #2) renders as an explicit
  amber "review with extra care" callout — closing a loop D13 opened:
  the flags `FraudChecksService` attaches are finally *seen* by the
  human they were attached for.
- Loading and empty are distinct states ("Loading…" vs "Queue is clear
  — nothing pending."), the Phase 9 issue #61 rule.

## Step-by-step: what actually got built and verified

1. **The API enrichment** in `ModerationService.listPending()`, with
   unit tests covering the three shapes, the null-entity fallback (a
   queue entry whose underlying row is missing renders "details
   unavailable" rather than crashing), and the hash-never-serializes
   assertion.
2. **A new e2e assertion** in the existing moderation spec: a fresh
   round rating's queue entry carries `companyName`/`roundTitle`/
   `roundType`/scores — proving the enrichment against real Postgres,
   not mocks.
3. **The page + typed client methods**, 5 component tests: all three
   entity types render with context, each action calls its endpoint and
   removes its card, the flag action sends the selected reason, and the
   empty state is explicit.
4. **e2e stress-run** — the suite ran 5x against kind's Postgres and
   OpenSearch (per D24/D26, prefix-isolated) after a single
   non-reproducible failure on the first run; five consecutive clean
   runs pinned it as a first-connection hiccup through freshly-created
   port-forwards, not a code defect. The distinction between "ran it
   again and it passed" and "characterized why it failed once" is one
   this project has had to learn more than once (D17).
5. **Real-browser verification (Playwright)**: seeded one pending entry
   per entity type via the API, navigated from the NavBar, then drove a
   different action on each — approve the round rating, reject the
   recruiter rating, flag the overall review as `spam_pattern` — and
   confirmed every transition *in kind's Postgres directly* via
   `kubectl exec` psql: statuses `approved`/`rejected`/`flagged`,
   `reviewed_by` recorded on all three, the flag reason on the flagged
   one. Zero console errors.

## What this enabled

Moderation is now an operation a person can perform, not a curl recipe
— across every entity type the platform has. With this merged, Phase
14's feature scope closed: the core entity hierarchy designed in Phase
1 is fully writable, fully moderated, and fully visible, end to end.
The next structural conversations it sets up are exactly the ones the
issue deferred on purpose: auth in front of this page (Phase 8), and
extending fraud checks and review search beyond `round_rating` when
something asks for them.
