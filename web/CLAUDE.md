# Web conventions (`web/`)

These apply to this Next.js frontend specifically — see the root
`CLAUDE.md` for project-wide rules.

- Tests live in top-level `tests/`, never colocated with `src/` —
  `jest.config.js`'s `testMatch` only covers `tests/**/*.spec.{ts,tsx}`, so
  a colocated spec file next to a component silently never runs.
- All API calls go through `src/lib/api.ts`'s shared `request()` helper,
  never raw `fetch()` — it sets `credentials: 'include'` (required for the
  session cookie to survive cross-origin) and handles 204-No-Content
  responses.
- Session-state UI (nav links, gating prompts) reads the non-httpOnly hint
  cookie (`hasCandidateSessionHint()` in `api.ts`), never a passive
  `GET /auth/me`/`GET /auth/admin/me` call — a real network session check
  is only for a page that actually needs the authenticated data itself.
- After anything that changes session state (login, logout, magic-link
  verify), redirect with `window.location.href`, not `router.push()` —
  `NavBar` only checks session at mount and won't notice a client-side
  route change.
- Client-side draft state (the review wizard) goes through
  `src/lib/draft-store.ts`'s helpers, backed by one versioned localStorage
  key — never write to localStorage directly elsewhere.
- Use `generateId()` (in `draft-store.ts`), not `crypto.randomUUID()`
  directly — it throws under Jest/jsdom and requires a secure context in
  real browsers, which none of this project's deployed environments have
  yet (plain HTTP, no TLS).
