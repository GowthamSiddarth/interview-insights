# Phase 48, Issue #683 — Retire Magic-Link as Primary Login; Update the Frontend

*Part of Phase 48 — Candidate Password Authentication.
See `docs/ROADMAP.md` Phase 48, D104.*

## Moving a page without breaking its own tests

`/login` had been the magic-link request form since Phase 16. Making
password login primary meant that page's *content* had to move somewhere
else, not disappear — the flow is still fully supported, just secondary
now. The fix was a straight file move: `web/src/app/login/page.tsx`'s
existing content became `web/src/app/login/magic-link/page.tsx`
unchanged (plus a link back to `/login`), and its test file moved with
it (`git mv tests/login-page.spec.tsx tests/magic-link-login-page.spec.tsx`,
import path updated). `/login` itself became a new password-login form
instead — its own new test file, reusing the *filename* the magic-link
test used to have, now covering different content entirely.

## Four pages, one shared shape

The new primary `/login` is a close cousin of the already-password-based
`/moderation/login` (Phase 18): email, password, a submit that calls
`api.candidateLogin()` and hard-navigates home on success. Three more
pages round out the flow, each a thin wrapper around one of #680-#682's
endpoints:

- `/register` — `api.registerCandidate()`, auto-logs in on success (the
  API itself does this — see #680's post).
- `/login/forgot-password` — `api.requestPasswordReset()`, same
  honest-confirmation-either-way copy pattern `/login/magic-link` already
  established for its own enumeration-safe endpoint.
- `/auth/reset-password` — `api.confirmPasswordReset()`. This one departs
  from `/auth/verify`'s pattern deliberately: `/auth/verify` auto-consumes
  its token the instant the page loads (nothing left to choose), but
  reset needs the candidate to actually pick a new password first, so
  the token just sits in the URL until the form submits. The path
  itself isn't arbitrary — it has to be exactly `/auth/reset-password`
  because that's the URL `CandidateAuthService.requestPasswordReset()`
  builds the emailed link from.

All four cross-link to each other (log in ↔ register ↔ forgot password ↔
the magic-link fallback), and `NavBar` needed zero changes — it already
just linked to `/login`, and that path's *meaning* changing underneath it
required no code change on its side.

## A label-association bug caught by the tests, not by hand-testing

Both new password fields originally carried a helper hint
(`<span>At least 12 characters.</span>`) nested *inside* the `<label>`,
next to the `<input>`:

```tsx
<label>
  Password
  <input ... />
  <span>At least 12 characters.</span>
</label>
```

Testing Library's `getByLabelText('Password')` computes a label's
accessible name from *all* of its text content, not just the text before
the input — so the query actually needed to match `"Password At least 12
characters."`, and every test using the exact string `'Password'` failed.
This wasn't a testing-library quirk to work around; it was accurate
behavior surfacing a real accessibility issue — the same thing a screen
reader would announce. The fix was moving the hint outside the `<label>`
as its own `<p>`, matching the plain-label convention
`moderation/change-password/page.tsx` already established elsewhere in
this app. Caught by the test suite before merge, not by manual
browser testing.

## Verification

`npx eslint`, the full `npm test` suite (253 tests, including five new
suites — one per new/moved page), and `npm run build` — confirming every
new route (`/register`, `/login/forgot-password`, `/login/magic-link`,
`/auth/reset-password`) compiles and prerenders as static content, same
as every other simple form page in this app.
