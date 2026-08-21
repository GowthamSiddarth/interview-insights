# Phase 56, Issue #816 — Confirm NEXT_PUBLIC_API_URL Is a Real Env Var at Hetzner Build Time

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56.*

## The question

Next.js bakes `NEXT_PUBLIC_*` environment variables in at *build* time,
not deploy time or runtime — a subtlety that's easy to get wrong,
since most other env vars in this stack are read at runtime. If
`web`'s Hetzner image build ever ran without `NEXT_PUBLIC_API_URL`
explicitly set, the code's own `localhost` fallback would get compiled
directly into the production bundle — every browser loading the real
pilot site would try to call `api` on `localhost`, a silent, totally
broken deploy that would look fine right up until the first API call.

## The finding: already correct, worth writing down why

`cd-hetzner.yml`'s `build-web-image` job already passes
`https://api.interviewinsights.fyi` as a real `--build-arg`. Confirmed,
and the *why it can't accidentally regress* reasoning recorded directly
above the fallback value it's protecting against:

```ts
// GitHub issue #816 (Phase 56) — confirmed: Next.js bakes NEXT_PUBLIC_*
// vars in at build time, not deploy time, so the localhost fallback below
// only ever matters for local dev. Every real image build sets this
// explicitly via --build-arg: cd-hetzner.yml's build-web-image job passes
// https://api.interviewinsights.fyi; dev/staging/prod overlays each pass
// [...]
```

Worth the extra sentence explaining *why* this class of bug is
dangerous (build-time baking, not runtime reading) — a future reader
skimming past a `localhost` fallback might reasonably assume it's the
same "safe, overridden at runtime" pattern every other env var in this
app follows, when it specifically isn't.

## Verification

Read `cd-hetzner.yml`'s actual `build-web-image` job directly to
confirm the `--build-arg` is present and correctly valued, rather than
inferring it from the deploy having "seemed to work" — a stale
`localhost` bake would only surface as a client-side network error in
the browser console, easy to miss in a quick smoke check.
