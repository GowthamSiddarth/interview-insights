# Phase 17, Issue #149 — My Reviews

*Part of Phase 17 — Candidate Self-Service. First issue in the phase —
Update/Delete (#150) and GDPR erasure (#151) both build on the read
path this issue establishes. See `docs/ROADMAP.md` Phase 17.*

## Why this is the natural first issue in the phase

Phase 16 gave candidates a real, session-backed identity. Phase 17 is
about what that identity actually unlocks — and the most basic thing a
logged-in candidate should be able to do is see their own submissions.
Every other Phase 17 issue depends on that read existing first: you
can't build an edit/delete UI (#150) without a page to put the
controls on, and you can't reason about "does erasure actually remove
everything" (#151) without a page that proves what "everything" is in
the first place.

## Key concept: grouped by `InterviewProcess`, not three flat lists

The issue as originally filed didn't specify a response shape. Before
writing any code, the Phase 17 kickoff brainstorm settled this: `GET
/me/submissions` groups its response by `InterviewProcess` — one entry
per company/role/outcome, with that process's round ratings, recruiter
rating, and overall review nested underneath — rather than three
separate flat arrays the frontend would have to cross-reference by
`processId` itself. This matches how a candidate actually thinks about
their own history ("my loop at Acme Corp"), not how the schema happens
to be normalized.

## Key concept: the one read path that shows every status

Every other read path in this codebase — company profiles, review
search, the moderation queue's public-facing effects — only ever
surfaces `approved` content (CLAUDE.md hard constraint #2: everything
starts `pending`). `GET /me/submissions` is deliberately the exception:
a candidate needs to see their own `pending`/`rejected`/`flagged`
submissions too, since otherwise they'd have no way to know whether
something they submitted is still waiting on moderation or was quietly
rejected.

```ts
async findMySubmissions(candidateId: string): Promise<MyProcessSubmissions[]> {
  const processes = await this.prisma.interviewProcess.findMany({
    where: { candidateId },
    orderBy: { createdAt: 'desc' },
    include: {
      company: true,
      rounds: { include: { ratings: { where: { candidateId } } } },
      recruiterInteractions: { include: { ratings: { where: { candidateId } } } },
      overallReview: true,
    },
  });
  // ...maps into the grouped shape
}
```

Every nested relation is re-filtered by `candidateId` again, even
though a process structurally has exactly one candidate already and
the filter is redundant today. This is defensive, not load-bearing —
the same instinct this codebase applies everywhere ownership matters:
trust the join, but check anyway, so a future schema change (a shared
round, say) can't silently leak another candidate's rating through an
unguarded include.

## Key concept: a round without a rating just isn't there

`roundRatings` is built with `flatMap`, not `map`:

```ts
roundRatings: process.rounds.flatMap((round) =>
  round.ratings.map((rating) => ({ id: rating.id, roundId: round.id, ...rating })),
),
```

A round the candidate never rated contributes zero entries, not an
entry with null fields — the `@@unique([roundId, candidateId])`
constraint guarantees at most one rating per round per candidate, so
this is a clean one-or-zero mapping, never ambiguous.

## System design approach

A new `api` `me/` module, `MeController`/`MeService`, gated by the
existing `CandidateJwtAuthGuard` — no new auth machinery needed, just
the standard `@CurrentCandidateId()` decorator every session-gated
write path already uses. On `web`, a new `web/src/app/me/page.tsx`
gated on the `candidate_logged_in` session-hint cookie (D32's pattern,
not a network probe) rather than a passive `GET /auth/me` poll — the
same reasoning issue #147 already established: a page anonymous
visitors might land on shouldn't make a doomed network call just to
decide what to render.

## Step-by-step: what actually got built and verified

1. **`MeService.findMySubmissions()`** — the grouped-by-process query
   above, with 4 unit tests (mocked Prisma): candidateId scoping, the
   full three-entity-type grouping shape, a round with no rating
   omitted entirely, and the empty-candidate case.
2. **`me-submissions.e2e-spec.ts`** (5 tests) against real Postgres:
   401 unauthenticated; an empty array for a candidate with nothing
   submitted; a full submission (round rating approved, recruiter
   rating rejected, overall review still pending) grouped correctly
   under one process with every status intact; another candidate's
   submissions never leaking through; a process with zero ratings yet
   still appearing with empty nested arrays rather than being omitted.
3. **`web/src/app/me/page.tsx`** — one card per process (company, role,
   outcome, a link to that company's profile), each nested rating/
   review shown with a color-coded status label matching this
   project's existing status conventions and its free text.
   Loading/empty/populated states are kept visually distinct
   throughout, per Phase 9 issue #61's rule.
4. **`NavBar` gained a "My reviews" link**, shown only when logged in —
   5 new component tests plus 2 new `NavBar` tests (48 web tests
   total).
5. **Live verification** (real `kind` Postgres/OpenSearch/Mailpit via
   port-forward, real dev servers, headless Chromium): logged in via a
   real magic link, confirmed `/me` showed the empty state before any
   submission, drove the full wizard (round rating + recruiter rating
   + overall review, all left pending), confirmed `/me` then showed
   all three grouped under one process card with "Pending" labels and
   a working company-profile link, logged out, and confirmed `/me`
   prompted to log in again with zero stale data leaking — zero
   console errors throughout.

## What this enabled

Everything downstream in Phase 17 builds directly on this page and
this query. Issue #150 adds Edit/Delete controls onto the same cards
`/me` already renders. Issue #151's GDPR erasure has a concrete,
verifiable definition of "everything" to check against: whatever
`/me/submissions` would have shown, across every entity type and every
status, must be gone after erasure.
