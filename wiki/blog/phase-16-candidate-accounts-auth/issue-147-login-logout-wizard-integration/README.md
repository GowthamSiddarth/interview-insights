# Phase 16, Issue #147 — Login/Logout UI + Wizard Integration

*Part of Phase 16 — Candidate Accounts & Auth. Depends on issue #146.
See `docs/ROADMAP.md` Phase 16.*

## Why this came last (of the feature issues)

Issue #146 broke `web`'s wizard on purpose — its "candidate email" step
called `POST /candidates`, which no longer exists once candidate
creation moved entirely inside the magic-link flow. This issue is the
promised catch-up: give `web` an actual login, and rebuild the wizard
around "you're already logged in" instead of "type your email into this
form."

## Key concept: ask first, don't render and fail

The same principle Phase 18 issue #160 established for the moderation
page applies here: check session state up front, rather than rendering
a form and letting its submission fail. A new `GET /auth/me`
(`candidate-auth.controller.ts`, mirroring admin's `GET /auth/admin/me`)
gives `web` that check. The wizard's step 2 doesn't collect an email at
all anymore — it shows either the process-creation form (session
present) or a "Log in to submit a review" prompt (no session), decided
before any submission is attempted.

## Key concept: a session check that runs on *every* page needs a different design than one that runs on *one*

This is the part that only surfaced during live browser verification,
not from any unit or component test, and it's worth explaining in some
detail because the fix generalizes beyond this one issue.

`web/src/components/NavBar.tsx` renders in the root layout — on every
route, for every visitor, logged in or not. The natural first
implementation had it call `GET /auth/me` on mount, exactly like the
moderation page's session gate. That's fine for a page only ever visited
by someone attempting to moderate. It's a real problem for a component
every single anonymous candidate sees on their very first, most common
page view: that call 401s, and Chromium logs every non-2xx fetch
response to the console as "Failed to load resource" — regardless of
whether the app's own `.catch()` handles the rejection cleanly. That's a
genuine "zero console errors" failure the moment more than one page is
visited anonymously, which is the overwhelmingly normal case for this
platform, not an edge case.

The fix: `candidate-auth.controller.ts`'s `verify()` now sets a second
cookie, `candidate_logged_in=1` — a plain, non-httpOnly companion to the
real `candidate_session` JWT, carrying no secret, set and cleared in
lockstep with it. `NavBar` and the wizard read this synchronously via
`document.cookie` (`api.hasCandidateSessionHint()`) instead of ever
calling the network just to decide what a nav link should say.
`GET /auth/me` itself is unchanged — still 401s on a missing session,
exactly like admin's — and stays the real source of truth for anything
that actually needs the candidateId value; nothing in `web` does yet, so
today it's only exercised by its own e2e test.

The alternative considered and rejected: making `GET /auth/me` return
200 with a null body instead of 401 when there's no session. That would
have special-cased candidate's endpoint away from the mirrored admin
pattern (`GET /auth/admin/me` intentionally 401s, and
`admin-auth.e2e-spec.ts` asserts it) to solve a problem that isn't
really about the endpoint's contract — it's about how often, and from
where, something calls it. Fixing the caller's behavior, not the
callee's contract, is what `docs/DECISIONS.md` D32 records as the
reasoning.

## Key concept: a client-side route change doesn't remount a persistent layout component

The second live-verification bug: after a successful verify, the
original code did `router.push('/')`. That's a client-side navigation —
and `NavBar`, mounted once in the root layout, persists across it rather
than remounting. Its `useEffect([])` session check had already run once,
before the cookies existed, and never ran again just because the URL
changed underneath it — so a real login left the nav bar stuck showing
"Log in" until the next full page load. Fixed with
`window.location.href = '/'` instead of `router.push('/')`: a hard
navigation remounts everything on the page fresh, so `NavBar` picks up
the newly-set cookies honestly. This is also documented in D32, since
it's the kind of bug that's easy to reintroduce by "simplifying" back to
`router.push` without realizing why it's there.

## System design approach

```
web/src/app/login/page.tsx          # email only, no password
web/src/app/auth/verify/page.tsx    # the landing route the emailed link points to
web/src/components/NavBar.tsx       # session state via the hint cookie
web/src/app/page.tsx                # step 2 gated on session, no email field
```

`/auth/verify` is not an arbitrary path choice — `CandidateAuthService
.requestLink()` builds the emailed link from `CORS_ORIGIN` (`web`'s own
origin), so the landing route has to live at exactly that path for the
link to work at all. The login page shows the same honest "if an
account exists…" confirmation regardless of whether the email is known,
matching `requestLink()`'s own non-enumerating behavior on the backend —
the UI shouldn't leak through wording what the API deliberately doesn't
leak through status codes.

## Step-by-step: what actually got built and verified

1. **The backend addition**: `GET /auth/me` plus the
   `candidate_logged_in` hint cookie, set in `verify()` and cleared in
   `logout()` alongside the real session cookie.
2. **`web/src/app/login/page.tsx`**: email-only form, posts to
   `POST /auth/request-link`, shows the confirmation state on success.
3. **`web/src/app/auth/verify/page.tsx`**: reads `token` from the URL
   (wrapped in `Suspense`, since `useSearchParams` requires it), posts
   to `POST /auth/verify`, hard-navigates home on success, shows a
   status-specific message (not-found / already-used / expired) with a
   link back to `/login` on failure.
4. **`NavBar` and the wizard's step 2**, both switched to read
   `api.hasCandidateSessionHint()` instead of calling the network.
5. **`api.ts` cleanup**: `createCandidate()` and the dead
   `POST /candidates` call removed per D31's own "revisit when" note;
   the four write-path client methods
   (`createProcess`/`createRoundRating`/`createRecruiterRating`/
   `createOverallReview`) dropped the now-rejected `candidateId` field
   from their request bodies — the wizard had been silently broken by
   issue #146's whitelist validation (a 400, not a 401) until this fix.
6. **3 new component test files** (`login-page.spec.tsx`,
   `verify-page.spec.tsx`, and an extended `nav-bar.spec.tsx`) plus 2
   existing files updated (`page.spec.tsx`,
   `recruiter-overall-steps.spec.tsx`) to drive the session-hint cookie
   instead of the removed email step — 42 `web` component tests total.
   `GET /auth/me` covered by 1 new e2e assertion (84 e2e tests total).
7. **Live end-to-end verification** via headless Chromium against real
   dev servers backed by kind's Postgres/OpenSearch/Mailpit
   (port-forwarded, per D24/D26/D29): request a link from `/login` →
   fetch it from Mailpit's REST API → land on `/auth/verify` →
   redirected home, logged in → create a company → create a process
   with no email field → add a round → submit a rating — confirmed the
   row landed in kind's Postgres via `kubectl exec psql`. This run is
   what caught both bugs described above; the first attempt genuinely
   failed on the stale-NavBar bug before the hard-navigation fix landed,
   and a version before the hint cookie genuinely logged three real
   console errors (home page, `/login` page, and `/auth/verify` page,
   each an anonymous `NavBar` mount) before that fix landed either — the
   "zero console errors" bar in this project's verification habit isn't
   a formality; it caught two real, user-visible bugs here.

## What this enabled

Phase 16's full feature scope (#144–147) is done: a real,
end-to-end-verified passwordless login loop, a write path that only ever
trusts the session, and a `web` UI that actually uses both correctly —
including for the platform's single most common case, an anonymous
visitor who hasn't logged in yet. Only the phase's engineering blog
(#148 — this set of posts) remained before the Phase 16 epic could
close.
