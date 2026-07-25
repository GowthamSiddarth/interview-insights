# Phase 26, Issue #254 — Flashcard-Style Step Navigation

*Part of Phase 26 — Client-Side Draft Wizard (Flashcard Navigation). See
`docs/ROADMAP.md` Phase 26.*

## Why "flashcard," and why it isn't actually a flashcard

The name suggests a swipe-through, one-way, commit-and-move-on pattern —
which is explicitly *not* what this issue asked for. The point of the
metaphor is that each step is its own self-contained card, not that you
can only go forward. Every step — the process itself, every round,
every recruiter touchpoint, the overall review — stays editable at any
time, in any order, right up until the candidate actually submits. That
distinction mattered enough that it's called out directly in the
issue's own scope: "explicitly reversible, not a one-way swipe-and-commit
flashcard pattern." Issue #253 built the data layer this needed; this
issue is the UI that makes free navigation and step add/remove actually
usable.

## Key concept: the registry does the work, the frontend just renders it

Phase 24 (issue #248) already built a round-type registry on the
backend — a single source of truth for which fields exist on which
round type, and which of those fields are free text versus a fixed set
of admin-managed options. The entire point of building that registry
was so a UI like this one would never need its own hardcoded
per-round-type logic. `type-metadata-fields.tsx` is the proof: it takes
a list of field definitions (each just a `key` and a `kind` — `text`,
`controlled-single`, or `controlled-multi`) and renders the right input
for each, with zero conditionals keyed on the round type itself. Add a
9th round type on the backend tomorrow, seed some option values for it,
and this component needs no changes at all to support it.

## Key concept: a step can be genuinely incomplete, and that's fine

Both round steps and recruiter steps support an optional rating,
toggled by a plain checkbox rather than being forced to fill in five
fields the moment you add a step. This isn't a UI nicety — it mirrors
something already true on the backend: the schema has always allowed a
round to exist with no rating (issue #260's whole reason for existing
was cleaning up exactly that state when it happened by accident). Here
it's deliberate: a candidate might want to log that a round happened
before they're ready to rate it, jump to another step, and come back
later. The checkbox is just making an already-legal state easy to
create on purpose.

## Key concept: "before rounds" and "after rounds," not a number line

Recruiter touchpoints needed some notion of *when* they happened
relative to the interview rounds, so the eventual review screen (issue
#255) could place them correctly. The schema has no field for this —
`RecruiterInteraction` doesn't carry any ordinal or timestamp beyond
`createdAt`. Two designs were on the table: give every step a freely
editable numeric position, or give recruiter steps a simple `'start'` /
`'end'` choice matching how the issue itself talks about them
("Recruiter — Start" and "Recruiter — End"). The second is simpler for
a candidate to reason about — nobody wants to manually juggle position
numbers — and it's exactly what the issue asked for in its own words,
so that's what shipped: a plain "before my interview rounds / after my
interview rounds" select, stored as a client-only `timing` field that
never reaches the backend.

## System design approach

```
web/src/app/wizard/
  step-navigator.tsx        # the free-jump step list + "add round"/"add recruiter" controls
  round-step-form.tsx        # title, description, registry-driven type_metadata, optional rating
  recruiter-step-form.tsx    # identifier, timing, optional rating
  type-metadata-fields.tsx   # generic text/controlled-single/controlled-multi renderer
  round-type-labels.ts       # the one remaining place the 8 round types are named for display
```

Notably, this directory has no `page.tsx` inside it — Next.js's App
Router only treats specifically-named files (`page.tsx`, `layout.tsx`,
etc.) as routes, so a folder of plain component modules under `app/`
doesn't create a new URL. This keeps the wizard's growing set of
sub-components colocated near the page that uses them without
accidentally exposing a route nobody asked for.

`page.tsx` wires it into a two-column layout once a draft is active —
`PageContainer`'s existing `size="wide"` variant, previously used for
dashboards, turned out to be exactly right here too.

## Step-by-step: what actually got built and verified

1. **`api.ts` gained `getRoundTypeFieldOptions()`**, fetched once when
   the wizard mounts.
2. **The four wizard components** described above, plus wiring in
   `page.tsx` to render the selected step's form based on `activeStepId`.
3. **10 new component tests** (`wizard-step-navigation.spec.tsx`) proving:
   two rounds of the same type stay independent; removing one round
   doesn't touch another; registry-driven fields render correctly for
   the selected round type; recruiter steps with different timings stay
   independent; a round with its rating survives a simulated reload.
4. **Live-verified** with a real headless browser against the real
   `kind` cluster: logged in, created a company, added a coding round
   (confirming the real seeded `problemAlgorithms`/`problemDataStructures`
   options rendered), added a second round, navigated back to the first
   and confirmed its title was untouched, added a recruiter touchpoint,
   reloaded the whole page, and confirmed all three steps survived
   intact — zero console errors.

Also worth noting from the live-verification pass: running both dev
servers via `nohup` from the *same* shell session leaked the API's
`.env`-sourced `PORT=3001` into the frontend server's environment
(`set -a` exports everything until unset), causing a real port
collision. Not a code bug, but a reminder that this project's own
verification habit occasionally finds problems in the verification
tooling itself, not just the feature under test.

## What this enabled

A candidate can now build up an arbitrarily complex interview record —
multiple rounds of the same type, touchpoints before and after the
loop, some rated and some not — entirely in the browser, jumping
between any of it freely. Issue #255 needed exactly this: a
fully-populated, freely-editable draft to finally render as one
coherent chronological review before the one real submit call.
