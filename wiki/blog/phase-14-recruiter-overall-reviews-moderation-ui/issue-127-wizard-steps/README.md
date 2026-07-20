# Phase 14, Issue #127 — Wizard Steps for Recruiter Experience + Overall Review

*Part of Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI.
Depends on issues #125 and #126. See `docs/ROADMAP.md` Phase 14.*

## Why this came third

Issues #125/#126 gave the API complete write paths — and left them in
exactly the state Phase 3's candidate email verification has been in
since it shipped: fully built, fully tested, reachable only by curl.
That's a known failure mode in this project by now (the
`docs/ARCHITECTURE.md` "Known gaps" section calls it out by name), so
the phase's planning pass included the UI issue up front rather than
leaving it to be noticed later.

## Key concept: the confirmation must tell the truth about moderation

CLAUDE.md hard constraint #2 says every rating/review write goes
through moderation before it's public. The UI corollary — established
by the Phase 2 wizard and enforced again here — is that a submission
confirmation must never *read* like publication. Both new steps show
the entity's real `status` straight from the API response ("submitted —
status: **pending**") plus the same "reviewed before it becomes public"
framing the round-rating step uses. A fake "Published!" message would
be lying to the user about a core product mechanic.

## Key concept: the form should disappear when the constraint says so

An overall review is one-per-process (`UNIQUE(process_id)`, issue
#126). The wizard reflects that structurally: once submitted, the form
is replaced by the confirmation and can't be reached again in that
session. A duplicate attempt from a stale tab still gets a clean 409
from the API surfaced in the error banner — the UI mirrors the
constraint, it doesn't replace it. Same idea, softer form, for the
recruiter-identifier field: its helper text says explicitly that the
identifier is "used only to tell recruiters apart — never shown
publicly," making hard constraint #1 visible to the person the promise
is actually made to.

## System design approach

Two new sections appended to the existing single-page wizard
(`web/src/app/page.tsx`), gated on a round existing — the same
progressive-reveal pattern every earlier step uses:

- **"5. Recruiter experience"** — recruiter identifier + four 1-5
  ratings (approachability, response time, timeliness, communication
  quality) + optional free text. Submission is two sequential API
  calls: create the `RecruiterInteraction` (which resolves the internal
  recruiter identity server-side), then create the `RecruiterRating`
  against it.
- **"6. Overall review"** — overall experience 1-5, a would-recommend
  checkbox, optional review text. One call.

`web/src/lib/api.ts` gained the three response types and three client
methods, keeping the whole app's API surface in the one typed client it
has had since Phase 2. State-wise the two steps are ordinary `useState`
slots that `handleChangeCompany()` now also resets — the Phase 9 issue
#59 rule that switching companies must clear every dependent step.

## Step-by-step: what actually got built and verified

1. **API client additions first**, so the page changes were purely
   wiring against a typed surface.
2. **The two sections** with their handlers — including the
   two-sequential-calls shape for the recruiter step and
   empty-string-to-undefined normalization for the optional text fields
   (the API's `forbidNonWhitelisted` validation rejects unexpected
   shapes, so the client sends nothing rather than `""`).
3. **3 component tests** (`recruiter-overall-steps.spec.tsx`) driving
   the full wizard against a route-based fetch mock: both sections
   appear only once a round exists; the recruiter step calls the
   interaction endpoint then the rating endpoint and shows the pending
   confirmation; the overall step sends the right payload and its form
   disappears afterward.
4. **Real-browser verification (Playwright)** against the dev servers
   backed by kind's Postgres per D24: the full 6-step flow, both new
   submissions confirmed `pending` in the moderation queue via a direct
   API check, zero console errors, full-page screenshot reviewed.
5. **Deployed manually, mid-incident.** The merge queued a CD run — and
   GitHub Actions was down: the self-hosted runner failed with a
   generic "SSL connection could not be established." The runner's
   `_diag` logs named the real error (`NotTimeValid` on the certificate
   chain), and `openssl s_client` against the Actions broker host
   confirmed it: GitHub was serving a Let's Encrypt certificate that
   had expired *31 minutes earlier* (githubstatus.com showed the
   matching incident). Rather than wait, the exact `cd.yml` sequence
   ran by hand — build with the same `GIT_SHA` build-arg, `kind load`,
   apply the overlay, roll out — and the same two proofs CD's own
   verification uses: `/health`'s `version` matching the merge SHA
   exactly, and the full Playwright flow re-run through the real
   Ingress-fronted `web`, not the dev servers.

## What this enabled

A candidate can now tell the whole story of an interview loop from one
page: every round, the recruiter relationship, and the overall verdict
— each landing in the same moderation pipeline with honest status
messaging. It also stocked the moderation queue with real pending
entries of all three types, which is exactly the state issue #128's
admin UI needed to exist for. And the deploy detour left a
transferable diagnostic pattern: when a .NET-based tool says "SSL
connection could not be established," the `_diag` inner exception and
one `openssl s_client | openssl x509 -noout -dates` will usually name
the culprit in under a minute — including when the culprit is GitHub's.
