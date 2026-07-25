# Phase 27, Issue #264 — Admin UI Page for Round-Type Field Options

*Part of Phase 27 — Admin Content Gateway (Round-Type Field Options).
See `docs/ROADMAP.md` Phase 27.*

## The gap this closed

Issue #263 built a complete admin API for managing round-type field
options — but curl-only. Every other admin-facing capability in this
project (moderation, since Phase 18) has a real UI; leaving this one
API-only would have made it the odd one out, and in practice unusable
for day-to-day content management.

## Key concept: derive the field list from data the app already fetches

The registry's public `GET /round-types/field-options` already
returns every round type's full field schema — including each field's
`kind` (`text` / `controlled-single` / `controlled-multi`). Rather than
duplicate that schema client-side or hardcode which fields are
controlled per round type, the admin page fetches this same public
endpoint once and filters out `kind: 'text'` fields — those have no
admin-managed vocabulary at all, by definition. Combined with issue
#263's new per-round-type admin listing (every value, active and
inactive), the page has everything it needs without inventing a new
data shape:

```ts
const controlledFields =
  roundType && schema ? schema[roundType].fields.filter((f) => f.kind !== 'text') : [];
```

## Key concept: one toggle handles both directions of retirement

The obvious design has two separate actions — "Retire" and
"Reactivate" — as different buttons. But issue #263's `PATCH` endpoint
already accepts `isActive` as a plain boolean in either direction; there
was no reason to build two code paths for what's structurally one
action. The UI renders a single button per row whose label and variant
flip based on the row's current `isActive` state:

```tsx
<Button
  type="button"
  variant={row.isActive ? 'danger' : 'neutral'}
  onClick={() => void handleToggleActive(row)}
>
  {row.isActive ? 'Retire' : 'Reactivate'}
</Button>
```

## Key concept: three genuinely different empty states, not one

Following this project's standing Phase 9 issue #61 rule (a loading
state must never look identical to an empty one), this page actually
has three distinct "nothing to show yet" states, each meaning
something different: no round type has been picked at all; the
schema/values are still loading for whichever round type *is* picked;
and a round type that's been picked has zero controlled fields (e.g.
`other`, whose only field is free-text `notes`). Collapsing any two of
these into the same message would have made the page's real state
ambiguous to whoever's using it.

## Step-by-step: what actually got built and verified

1. `web/src/lib/api.ts` gained `RoundTypeFieldOptionRow` plus three
   client methods (`listRoundTypeFieldOptionsAdmin`,
   `createRoundTypeFieldOption`, `updateRoundTypeFieldOption`).
2. A new `web/src/app/moderation/round-type-options/page.tsx`, session-
   gated identically to `moderation/page.tsx` (`GET /auth/admin/me`
   check, redirect on 401). A round-type `<select>` drives a
   `FieldSection` card per controlled field, each showing every value
   with inline-editable value/sortOrder, the retire/reactivate toggle,
   and an "add value" form.
3. `/moderation`'s header gained a "Manage round-type field options"
   link; the new page gained a "Back to moderation queue" link closing
   the loop — the same entry-point pattern Phase 15 issue #142
   established for company profile/analytics pages.
4. 7 new component tests cover the session-gate redirect, both
   non-loading empty states, loading existing values, adding a new
   one, retiring one, and a retired value's own Reactivate affordance
   — 125 web tests total.
5. Live-verified with a real headless browser (Playwright) against the
   real `kind` cluster end to end: logged in as admin, navigated to
   the new page via the header link, selected "Coding," added a real
   value, confirmed it reached the public endpoint via a direct API
   check, retired it, confirmed it left the public endpoint while
   staying visible (marked inactive) in the admin list, navigated back
   via the back-link — zero console errors throughout.

## What this enabled

The round-type registry's controlled vocabulary — seeded with
illustrative defaults back in Phase 24 — is now genuinely
admin-manageable end to end, closing the last gap D47 explicitly
deferred. With both feature issues done, Phase 27 is complete.
