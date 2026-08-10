# Phase 20, Issue #217 — Honest Login-Page Copy + Lock Down `POST /companies`

*Part of Phase 20d — Product/UX Polish from Live Verification (originally
filed under Phase 20 — Operational Hardening & Live-Verification
Findings, epic #214, split out 2026-08-09 — see `docs/ROADMAP.md`'s
Phase 20 retired stub). Two product-review findings, unrelated to each
other except in how they surfaced. See `docs/ROADMAP.md` Phase 20d and
`docs/DECISIONS.md` D38.*

## Why this is two findings in one issue, not two issues

Both came out of the same conversation — a straightforward "let me
actually look at the login flow and the wizard" review — and both are
small, contained fixes rather than new features. Bundling them avoided
the overhead of two nearly-identical planning/verification passes for
work that's really one sitting's worth of review findings.

## Finding 1 — the login form already registers you; its copy didn't say so

`CandidateAuthService.requestLink()` has always upserted the candidate:

```ts
async requestLink(email: string): Promise<void> {
  // Same upsert CandidatesService.create() already does — a returning
  // candidate resolves back to the same pseudonymous row instead of
  // creating a duplicate.
  const candidate = await this.candidatesService.create({ email });
  // ...issues and emails the magic link
}
```

There's no separate registration flow anywhere in this system — the
login form *is* the registration flow, for both a returning candidate
and a brand-new one. But the confirmation copy read:

> "If an account exists for X, a login link is on its way."

That phrasing is a direct copy of an anti-enumeration pattern — the
kind of hedge you write when you genuinely don't want to reveal whether
an email is registered, because revealing that is itself a privacy
leak. It made sense as boilerplate, but it doesn't actually fit this
system: the endpoint already always returns the identical `{ status:
'ok' }` shape and always upserts, so there is nothing left to
enumerate. The hedge wasn't protecting anything — it was just
confusing, making a brand-new user wonder whether the link would even
arrive.

Fixed by saying plainly what actually happens:

> "A login link is on its way to X — first time here? It creates your
> account too."

## Finding 2 — an anonymous-write gap that predated Phase 16 entirely

`POST /companies` had never been session-gated or rate-limited. This
wasn't an oversight introduced by any single phase — it's that
`Company` has no `candidateId` column at all, so when Phase 16's
"sessions on the write path" pass swept every `candidateId`-bearing
write path under a session requirement, `Company` was never on that
list because it structurally has nothing to attribute. That's a
correct reason for why it wasn't caught automatically — not a reason it
should stay open indefinitely.

## Key concept: gate the write, not the read, and never confuse the two

The fix is deliberately narrow in exactly the same shape at every
layer:

- **Backend**: `POST /companies` gated with `CandidateJwtAuthGuard` +
  a new per-IP `CompanyCreationThrottleGuard` (mirroring
  `MagicLinkThrottleService`'s `IpThrottle` shape exactly). `GET
  /companies` — reading the list, searching, viewing a profile — stays
  completely untouched.
- **Frontend**: the wizard's "existing company" picker (a list of
  buttons, just a read) stays visible and functional regardless of
  login state. Only the *create a new company* form is gated on
  `candidateSession`, matching the backend gating only the `POST`.

Both together — session *and* throttle, not one or the other. The
session requirement means an abuser needs a real, working magic-link
login first (itself already throttled); the IP throttle is defense in
depth layered on top of that, the same reasoning `EditThrottleGuard`
(D33) already established for a different write path. Unlike every
other session-gated write in this codebase, this isn't about
*attributing* the write to a candidate — `Company` still has no
`candidateId` after this change. It's purely access control and abuse
prevention.

## System design approach

```ts
@Post()
@UseGuards(CandidateJwtAuthGuard, CompanyCreationThrottleGuard)
create(@Body() dto: CreateCompanyDto) {
  return this.companiesService.create(dto);
}
```

`CompanyCreationThrottleService`/`Guard` are new, standalone files —
not a shared, generic "IP throttle for anything" abstraction. This
matches the existing pattern: `LoginThrottleService`,
`MagicLinkThrottleService`, and now this one are each their own small
class wrapping the shared `IpThrottle` core, kept as separate counters
deliberately (an IP throttled on one write path shouldn't also block an
unrelated one).

## Step-by-step: what actually got built and verified

1. Login-page copy rewritten (both the form's intro text and the
   post-submission confirmation) to stop implying login-only.
2. `CompanyCreationThrottleService`/`Guard` — new, mirroring
   `MagicLinkThrottleGuard` exactly. `CandidateJwtAuthGuard` +
   the new guard added to `CompaniesController.create()`.
3. `web`'s wizard: the create-company form wrapped in the same
   `candidateSession` gate the process-creation step already used,
   with a "Log in to add a company that isn't listed yet" prompt when
   logged out — the existing-company picker stays ungated.
4. **The invasive part**: every e2e spec calling `POST /companies` (13
   files, 20 call sites) needed a candidate cookie attached. In the
   large majority of cases this was genuinely a one-line addition —
   the test already logged in a candidate moments before for an
   unrelated reason, so it was just a matter of reusing that cookie.
   A handful needed either a fresh throwaway login added purely for
   the company-creation step, or — in two tests specifically about
   proving an *unauthenticated* request fails — the existing login
   reordered to happen *before* company creation instead of after,
   since company creation itself was no longer the unauthenticated
   case those two tests were actually testing.
5. Verified live in a real browser: an anonymous visit to the homepage
   shows a "Log in" prompt instead of the create-company form; logging
   in via a real magic link reveals the form; creating a company
   succeeds while logged in; a direct unauthenticated `POST /companies`
   call returns 401 — zero console errors throughout.

## What this enabled

Two small, real gaps closed in one pass, both found by simply using the
product rather than through planned feature work — which is exactly
the pattern this entire phase (#215-#218) turned out to follow.
