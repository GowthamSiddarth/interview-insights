# Phase 2.3 — Frontend Wizard & Real-Browser Verification

*Part of Phase 2 — Thin vertical slice. See `docs/ROADMAP.md` Phase 2.*

## Why this came first

Phase 2.1 and 2.2 proved the API worked via `curl` and `supertest` — both
of which bypass a browser entirely. A real end user drives this app
through a browser, and a browser enforces things `curl` and Node-based
HTTP clients simply don't: CORS preflight checks, cookie/credential
handling, actual DOM rendering and hydration. This phase's frontend work
is also where a real, previously invisible bug surfaced — and *why* it
was invisible until this point is itself the most reusable lesson from
this post.

## Key concepts

- **A wizard, not a form.** The UI mirrors the entity hierarchy directly:
  pick or create a company → create a candidate + process → add a round →
  submit a rating. Each step only renders once its prerequisite exists
  (`{company && (...)}`, `{process && (...)}`, `{round && (...)}` in React)
  — there's no way to reach the rating form without a round existing
  first, matching the real foreign-key dependency chain from Phase 1's
  schema.
- **The frontend and backend can each report "success" independently while
  the actual feature is broken.** This is the core lesson of this phase.
  `curl -X POST http://localhost:3001/companies` succeeding, and
  `npm run build` succeeding for `web`, both say nothing about whether a
  browser loaded at `localhost:3000` can actually talk to
  `localhost:3001` — those are two different origins from a browser's
  perspective, and only a browser enforces same-origin policy.
- **"Verified" means driven in an actual browser, not inferred from
  passing builds/tests.** This is why `CLAUDE.md`'s conventions and every
  phase's status notes in this project distinguish "unit/integration
  tests pass" from "manually verified: ... actually running both servers
  and driving it with a headless-Chromium (Playwright) script" — the
  latter is a categorically stronger claim, and this phase is where that
  distinction was learned the hard way.

## Core technologies

- **Next.js (App Router) + Tailwind**, a single client component
  (`'use client'`) driving the whole wizard with local `useState` — no
  global state library needed for a linear, single-user flow this small.
- **Native `<form action={...}>` with `FormData`**, React 19's newer
  pattern for form submission — each step's handler
  (`handleCreateCompany`, `handleCreateProcess`, ...) is an `async`
  function receiving `FormData` directly, reading fields with
  `formData.get(...)`, rather than manually wiring `onChange` handlers
  for every input.
- **A small `api.ts` client wrapper** around `fetch`, throwing a typed
  `ApiError` on non-2xx responses so every handler can catch one error
  type and render it consistently.
- **Playwright**, driven from the command line via a throwaway Node
  script (not a checked-in test file) — launched a real headless
  Chromium, navigated to the actual running `web` dev server, and clicked
  through the actual wizard, screenshotting each step.

## System design approach

The wizard's state model is deliberately linear and mirrors the backend
hierarchy exactly — five pieces of `useState`, each unlocking the next
section of the page once set:

```typescript
const [companies, setCompanies] = useState<Company[]>([]);
const [company, setCompany] = useState<Company | null>(null);
const [candidateId, setCandidateId] = useState<string | null>(null);
const [process, setProcess] = useState<InterviewProcess | null>(null);
const [round, setRound] = useState<Round | null>(null);
const [rating, setRating] = useState<RoundRating | null>(null);
```

Each section of the JSX is gated on the previous step's state being set
(`{company && (...)}`), so the UI structurally cannot let a user try to
add a round before a process exists — the same one-directional
dependency Phase 1's foreign keys enforce at the database layer, now also
true of what's even *renderable* in the UI.

The bug this phase actually found, though, lived one layer below the
UI's own logic — in how the browser talks to the API at all.

## The bug: CORS, invisible to every check except a real browser

`api` and `web` run on two different origins locally
(`http://localhost:3001` and `http://localhost:3000`) — different ports
count as different origins under the same-origin policy. A browser
issuing a cross-origin `fetch` first sends a CORS *preflight* `OPTIONS`
request, and refuses to let the actual request's response reach
JavaScript unless the server responds with the right
`Access-Control-Allow-Origin` header. NestJS does **not** enable CORS by
default.

Here's what made this bug specifically dangerous: every check performed
*before* driving the app in a real browser reported success.

- `curl -X POST http://localhost:3001/companies -d '...'` — succeeds.
  `curl` doesn't implement CORS at all; it's not a browser, so there's no
  same-origin policy to enforce, and no preflight request is ever sent.
- `npm run build` / `npm test` for `web` — succeeds. Nothing in a Jest
  unit test with a mocked `fetch` exercises real browser CORS enforcement
  either.
- `npm run build` / `npm run test:e2e` for `api` — succeeds. `supertest`
  (Phase 2.2's e2e tests) talks directly to the Nest HTTP server; it's
  also not a browser.

The *only* way to observe this bug was to actually load `web` in
something that behaves like a real browser and click the "Create
company" button — at which point the browser's devtools console shows a
CORS error, and the network tab shows the preflight `OPTIONS` request
failing. This is exactly why the Playwright verification step exists as
its own distinct, non-skippable phase of work — a categorically
different class of check than build/lint/unit/integration tests, because
it's the only one that reproduces what an actual user's browser does.

The fix, once found, was a single line in `main.ts`:

```typescript
app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' });
```

`CORS_ORIGIN` is read from the environment (rather than hardcoded)
specifically so this keeps working once `web` is served from somewhere
other than `localhost:3000` — a concern that turned out to matter again,
much later, in Phase 7's Kubernetes work, where `CORS_ORIGIN` had to
match a real Ingress hostname instead.

## Step-by-step: what actually got built

1. **Built the wizard UI** in `web/src/app/page.tsx` — one page, five
   sequential sections, each a small `<form>` posting to the
   corresponding Phase 2.1 endpoint via the `api.ts` client wrapper.
2. **Ran both servers locally** — `api` via `npm run start:dev`, `web`
   via `npm run dev` — and manually clicked through the wizard in a
   normal browser first. It looked like it worked, superficially — until
   opening devtools revealed the CORS preflight failure in the console
   (silently swallowed by React's error handling in a way that made the
   UI *look* like nothing happened, rather than showing an obvious
   crash).
3. **Wrote a disposable Playwright script** (not committed — a
   throwaway verification tool, the same pattern reused in every later
   phase's manual-verification step) that launched headless Chromium,
   navigated to `localhost:3000`, and drove the wizard exactly the way a
   real user would: fill the company form, click submit, wait for the
   next section to appear, repeat through candidate/process/round/rating.
   Screenshotted every step for a visual record.
4. **Diagnosed the CORS failure** from the Playwright run's console/
   network output (Playwright surfaces both, unlike a quick manual
   click-through where the failure can be easy to miss).
5. **Fixed it** with `app.enableCors({ origin: process.env.CORS_ORIGIN ??
   'http://localhost:3000' })` in `main.ts`, plus a `CORS_ORIGIN` entry in
   `api/.env.example`.
6. **Re-ran the exact same Playwright script** end to end, confirming
   every step of the wizard now actually completes, the rating submits
   with a `pending` status shown in the UI, and zero console errors are
   logged — the same "zero console errors" bar every subsequent phase's
   browser verification holds itself to.
7. **Added a colocated unit test for the page** (`web/tests/page.spec.tsx`,
   using React Testing Library with a mocked `fetch`), to cover the
   cheap, fast-feedback case — but explicitly *not* as a replacement for
   the Playwright pass, since a mocked `fetch` can never reproduce a real
   CORS failure either.

## What this enabled

Every subsequent phase that touched the frontend — Phase 4's analytics
dashboard, Phase 5's search UI, Phase 7's Kubernetes Ingress routing —
repeated this exact verification discipline: run the real thing, drive it
with Playwright, check for zero console errors, and only then call it
done. This phase is also where `CORS_ORIGIN` being environment-driven
(rather than hardcoded to `localhost`) first mattered, and it mattered
again, unmodified, when Phase 7 needed the API reachable from a
completely different origin behind a Kubernetes Ingress — a small design
choice made here paid off three phases later without anyone having to
remember why it was made that way.
