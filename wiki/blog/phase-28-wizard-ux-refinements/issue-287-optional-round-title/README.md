# Phase 28, Issue #287 — Optional Round Title + "{Type} - {Title}" Display

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why "untitled" was the wrong fallback

`Round.title` had been a required (`NOT NULL`) column since Phase 1,
and every place that displayed a round rendered the literal word
"untitled" when a candidate hadn't gotten around to naming it —
"Round 1: untitled — Coding." That's an odd thing to show a candidate
who never had a reason to name a round in the first place: a title is
genuinely optional information (which coding round was it, if there
was only one?), not a placeholder waiting to be filled in.

## The fix, in two parts

**Schema**: `Round.title` becomes nullable
(`ALTER TABLE rounds ALTER COLUMN title DROP NOT NULL`), and
`CreateRoundDto`/`CreateBulkRoundDto` drop the not-empty requirement.
No data migration needed — existing rows keep their titles unchanged.

**Display**: a single shared helper,
`web/src/lib/format-round-label.ts`:

```ts
export function formatRoundLabel(typeLabel: string, title?: string | null): string {
  return title ? `${typeLabel} - ${title}` : typeLabel;
}
```

applied everywhere a round is shown — the wizard's step navigator and
review screen, the company profile page, `/me`, and the moderation
queue — so a title renders as "Coding - Technical Screen" when present
and just "Coding" (no dash, no placeholder word) when it isn't.

## Key concept: a shared formatter is what makes "everywhere" actually mean everywhere

Before this, three different pages had their own bespoke way of
combining a round's type and title — one used "{title} ({type})," one
used "{type} ({title})," and one gated the entire round segment on
`roundTitle` being truthy at all. Introducing one function used by
every consumer wasn't just about consistency going forward — it
surfaced a real, pre-existing bug: the moderation queue's round detail
only rendered *any* round information (type included) when a title was
present. Once `title` became legitimately optional, a round with no
title would have silently stopped showing its round type too, in the
one place (moderation) where a reviewer needs to know what they're
looking at. The fix was gating on `roundType` instead, which is always
present for a `round_rating` moderation entry — a bug this
optionality change made real, caught by working through every display
site rather than just the one the original request named.

## Step-by-step: what actually got built and verified

1. Migration + DTO changes for the nullable column.
2. `formatRoundLabel()` added and wired into `step-navigator.tsx`,
   `review-screen.tsx`, the company profile page, `/me`, and the
   moderation queue (fixing that last one's `roundTitle`-gated
   condition along the way).
3. `RoundStepForm`'s title input relabeled "Title (optional)".
4. `draft-store.ts`'s client-side validation no longer requires a
   round title.
5. New unit tests for `formatRoundLabel()` itself (with/without a
   title), a `validateDraft()` regression test confirming a title-less
   round produces no issue, and an e2e test proving a round created
   with no title round-trips as `null`, end to end, against real
   Postgres.

## What this enabled

A round is exactly as much information as a candidate chooses to give
it — a type is always required (it's structural), a title is a
convenience for when there's more than one round of the same type to
tell apart, and every page that shows a round now says so consistently
rather than four different ways.
