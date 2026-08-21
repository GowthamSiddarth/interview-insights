# Phase 56, Issue #818 — Rating-Input min/max Attributes Are Cosmetic, Not Enforcement

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56.*

## The gap

Every rating `<input type="number" min={1} max={5}>` in the wizard
looks, at a glance, like real client-side validation — the browser
natively supports enforcing `min`/`max` on number inputs. It doesn't
actually do anything here: these inputs never sit inside a submitted
`<form>` at all. The wizard's "Submit" control is a `type="button"`
click handler, not a native form submission — the one mechanism that
would trigger the browser's built-in `min`/`max` constraint validation
never fires. A candidate can type `9` into a difficulty field and the
browser raises no complaint whatsoever; the attributes are purely
visual/informational (a stepper's implicit bounds, screen-reader
hints), doing none of the enforcement work they appear to.

## The fix: document it, so the real enforcement doesn't get deleted by mistake

No behavior change — the real validation
(`draft-store.ts`'s `validateDraft()`) already exists and already
works; the risk this issue addresses is a *future* mistake, not a
current bug. Someone reading this component cold could reasonably
conclude the `min`/`max` attributes are "the validation" and remove
`validateDraft()`'s corresponding check as duplicate work — exactly
backwards, since removing that would remove the only enforcement that
actually exists:

```tsx
{/* GitHub issue #818 (Phase 56) — min/max below are cosmetic
    only: these inputs never sit inside a submitted <form> (the
    wizard's own "Submit" is a type="button" handler, not a
    native submit), so the browser's native min/max validation
    never actually runs. draft-store.ts's validateDraft() is the
    real, working enforcement — don't remove it on the
    assumption these HTML attributes are doing the job. */}
```

## Verification

Confirmed by direct inspection: no `<form onSubmit>` anywhere in the
wizard's component tree, and the "Submit" control is a plain button
click handler that calls `validateDraft()` explicitly before proceeding
— the actual enforcement path traced end to end, not assumed from the
presence of `min`/`max` attributes that look like they'd be doing it.
