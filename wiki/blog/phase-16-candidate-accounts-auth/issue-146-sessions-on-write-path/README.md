# Phase 16, Issue #146 — Sessions on the Write Path

*Part of Phase 16 — Candidate Accounts & Auth. Depends on issue #145.
See `docs/ROADMAP.md` Phase 16.*

## Why this closes a real gap, not a hypothetical one

Every candidateId-bearing write in this codebase, up through Phase 15,
trusted whatever `candidateId` a client put in the request body. Issue
#145 built a real, working session — but until something actually
required it, that session was optional decoration: anyone could still
submit a rating "as" any candidate they liked, simply by typing a UUID
into a form field or a curl command. This issue is what turns "there is
a session" into "the session is the *only* source of truth for who's
writing."

## Key concept: trust the schema over the issue's own prose

The issue's own description named three write paths: "round rating,
recruiter interaction+rating, overall review." Grepping
`api/prisma/schema.prisma` directly for every `candidateId` field —
rather than trusting that list — turned up a fourth:
`InterviewProcess` creation (`POST /companies/:companyId/processes`)
has a `candidateId` column too, easy to miss on a first read since it
isn't a "rating" or "review" by name. The same grep also clarified a
subtlety the issue's phrasing blurred: `RecruiterInteraction` itself has
*no* `candidateId` — only its child `RecruiterRating` does — so
"recruiter interaction+rating" was really naming one write path, not
two. This is the same discipline issue #144 needed for Mailpit's
undocumented API and #159 needed for the JWT payload leak: read the
actual system, don't just trust the description of it.

## Key concept: no fallback for unauthenticated writes

The issue explicitly asked for this to be decided and documented, not
just implemented one way by default: an unauthenticated request to any
of the four write paths gets a plain 401. No anonymous-submission
grace period, no soft-fail-to-null. `docs/DECISIONS.md` D31 records this
as the deliberate answer, not an oversight.

## Key concept: whitelist validation as a structural guarantee, not a convention

`candidateId` isn't just ignored on the incoming DTOs — it's removed
from them entirely (`CreateRoundRatingDto`, `CreateRecruiterRatingDto`,
`CreateOverallReviewDto`, `CreateInterviewProcessDto`). Combined with
`main.ts`'s global `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true })`, a client that supplies `candidateId` in
the body doesn't get silently ignored — the whole request is rejected
with a 400. That's a stronger guarantee than "the code doesn't read that
field": there is no code path where a supplied value could leak through
even by accident, because the field can't exist on the parsed object at
all. `sessions-on-write-path.e2e-spec.ts` asserts this directly, not
just the 401 case.

## `POST /candidates` removed entirely — not just gated

Candidate creation is upsert-by-email logic
(`CandidatesService.create()`) that now runs *only* inside
`POST /auth/request-link`. A parallel public `POST /candidates` route —
even if gated behind nothing new — would have stayed a second way to
mint a candidate identity without ever proving email ownership, directly
undermining this issue's whole point. `GET /candidates/:id` is
unchanged, since it's a read and out of scope.

## System design approach

`CurrentCandidateId`, a `createParamDecorator` wrapper backed by
`CandidateJwtAuthGuard`, is the only way any controller method reads a
candidateId now:

```ts
@Post()
@UseGuards(CandidateJwtAuthGuard)
create(@CurrentCandidateId() candidateId: string, @Body() dto: CreateXDto) { ... }
```

Each of the four services takes `candidateId` as a separate method
parameter instead of reading it off the DTO — a small but deliberate
shape change that makes "where did this value come from" visually
obvious at every call site.

## Step-by-step: what actually got built and verified

1. **A new shared e2e helper**, `api/test/support/candidate-session.ts`'s
   `loginAsCandidate()`, driving the real request-link → Mailpit →
   verify → cookie loop (mirroring admin-auth's `loginAsAdmin()`).
2. **A new dedicated `sessions-on-write-path.e2e-spec.ts`** (8 tests)
   proving the core guarantee directly, once, in one place: 401
   unauthenticated across all four paths, and a client-supplied
   `candidateId` rejected outright rather than silently used.
3. **Seven existing e2e specs updated** to authenticate via
   `loginAsCandidate()` — `vertical-slice`, `moderation`,
   `fraud-checks`, `overall-reviews`, `recruiter-ratings`,
   `review-search`, `company-reviews` — and all seven converted from a
   shared `beforeAll` app to a fresh app per test. The same throttle-
   state-sharing bug issue #145 first hit recurred here at a larger
   scale: `overall-reviews.e2e-spec.ts` actually failed with 429s once
   several tests each needed their own candidate login, and several
   other files were sitting exactly at the 5-per-window boundary,
   passing only by luck. `beforeEach`/`afterEach` is now the default
   pattern for any e2e spec that logs in more than once or twice per
   file.
4. **4 unit test files updated** (DTO + service specs for the three
   ratings/reviews, DTO spec for interview-processes) plus **2 new
   ones** for the `CurrentCandidateId` decorator, extracted separately
   from its `createParamDecorator` wrapper specifically so it could be
   unit-tested in isolation.
5. **The full e2e suite (83 tests at the time) run twice back to back**
   to confirm the per-test-app fix wasn't a lucky single pass.
6. **Live verification against the real `kind` cluster**: confirmed
   `POST /candidates` now 404s, an unauthenticated write 401s, and the
   full request-link → email → verify → session → authenticated write
   loop succeeds end to end through the real Ingress.

## What this enabled — and what it deliberately broke

The core security guarantee this whole phase exists for is now real and
enforced, not just possible. The direct consequence: `web`'s wizard,
which had been calling the now-removed `POST /candidates` from its very
first step, is broken from this commit forward — on purpose, the same
"the frontend catches up in the next issue" sequencing Phase 18 used
(issue #159 broke the moderation UI deliberately; #160 fixed it). Issue
#147 is that catch-up here.
