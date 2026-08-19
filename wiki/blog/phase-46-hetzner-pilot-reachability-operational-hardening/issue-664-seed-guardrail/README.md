# Phase 46, Issue #664 — Guardrail Against Running `seed-demo-data`/`seed-demo-data-undo` Against the Pilot

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track B.*

## The gap this closed

D96 retired the old `--i-know-this-seeds-fake-data` confirmation flag
(D61/#383's original guardrail) once this project consolidated down to
one Postgres environment — with only `dev` left to worry about,
requiring an opt-in flag for "the wrong database" stopped making sense.
The Hetzner pilot is the first real non-dev environment since — the
exact situation D96's own "revisit once a real non-dev environment
exists" note was written for.

## A narrow, env-var-gated guard, not a broad flag

```ts
export function assertSeedingAllowed(): void {
  if (process.env.DEPLOYMENT_ENV === 'hetzner-pilot') {
    throw new Error(
      'Refusing to run: DEPLOYMENT_ENV=hetzner-pilot. seed-demo-data and ' +
        'seed-demo-data-undo write and delete data via real service calls and ' +
        'must never run against the pilot\'s real database.',
    );
  }
}
```

`overlays/hetzner-pilot`'s ConfigMap (#646) is the only place that ever
sets `DEPLOYMENT_ENV=hetzner-pilot` — `dev`/`staging`/`prod` all leave
it unset, so this stays a no-op everywhere except the one environment
it's meant to protect. Called at the top of both scripts' mutating
paths (`--list`, which is read-only, is deliberately left unguarded).

## Verification

Unit tests cover all three states directly — unset (no throw), any
other value like `dev` (no throw), and `hetzner-pilot` (throws with a
message naming the exact reason):

```
34 passed, 34 total
```

No live run against the actual pilot was needed or attempted to prove
this — the guard's own logic is fully exercised by the unit suite, and
deliberately never exercised for real, since a real trigger would mean
the thing it's meant to prevent already happened.
