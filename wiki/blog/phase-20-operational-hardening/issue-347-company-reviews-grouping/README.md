# Phase 20, Issue #347 — Company Reviews, Grouped by Submission

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Epic #214 reopened and re-closed the same day, same precedent as
#222/#240/#278/#312. See `docs/ROADMAP.md` Phase 20 and
`docs/DECISIONS.md` D54.*

## The same bug, found twice, on two different pages

Phase 29 issue #315 fixed the moderation queue's flat-list problem: a
multi-round submission was listed as one row per round/rating/review,
repeating the same company/role context each time. A live-usage report
found the exact same shape of bug on a completely different, public-
facing page: the company profile's Reviews section listed every
approved `round_rating` as its own row and labeled the count "N
reviews" — a single interview loop with 3 rated rounds (2 coding + 1
tech screening) inflated the visible count, reading "4 reviews" when
the real answer was 2 (one 3-round submission, one unrelated 1-round
submission). The report was blunt and correct: "each submission is 1
review."

## Key concept: the fix reuses a pattern, but pagination makes it harder here

`ModerationService.listPending()`'s grouping (#315) had no pagination
to worry about — it always returns the whole pending queue.
`CompaniesService.findApprovedReviews()` does paginate, and that's
where a naive port of the same fix would have introduced a new bug:
paginating raw round-rating rows first, then grouping whatever landed
on the current page, would risk splitting one submission's rounds
across a page boundary — two of a submission's three rounds on page 1,
the third stranded alone on page 2.

The fix has to paginate the *groups*, not the rows: fetch every
approved rating for the company (unbounded, same accepted full-table-
scan tradeoff D13 already established for fraud-check duplicate
detection), group them in application code by `round.processId`, then
slice the *group array* for the requested page.

```ts
const groups = Array.from(groupsByProcess.values());
const total = groups.length;
const items = groups.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
return { total, page, pageSize, items };
```

`total` now means "how many submissions," not "how many rows" —
exactly the number the count label displays, and exactly what the
report asked for. A test proves the boundary case directly: three
ratings, two under one process and one under another, with `pageSize:
1` — the first page returns the full 2-rating group intact, never a
partial one.

## Key concept: reusing an existing gate for free

Phase 21 (issue #226) already soft-gates the Reviews section — an
anonymous visitor sees one free review, the rest behind a login
prompt (`GatedSection`). That logic operates on `reviews.items[0]` vs.
`reviews.items.slice(1)`; once `items` became an array of *groups*
instead of raw ratings, the gating code needed no changes at all — it
was already agnostic to what an "item" contained. The company
profile page just needed a new `ReviewGroupItem` component (one
collapsed card per submission, expanding on click to reveal every
round's full detail) in place of the old flat `ReviewItem`.

## Step-by-step: what actually got built and verified

1. `CompaniesService.findApprovedReviews()` rewritten to group in
   application code and paginate the group array, mirroring
   `ModerationService`'s own `Map`-keyed grouping shape.
2. `CompanyReviewItem` (frontend) dropped `roleTitle` — it moved to a
   new group-level `CompanyReviewGroup.roleTitle`, since every round
   in one submission shares the same role.
3. A new `ReviewGroupItem` component on the company profile page: one
   collapsed card per submission (role + a real round count),
   expanding to reveal each round's detail via the existing
   `ReviewItem`.
4. 4 new/updated api unit tests + 3 new e2e tests against real
   Postgres prove: multiple ratings under one process group into one
   item; different processes stay separate; a page boundary never
   splits one submission's rounds — 310 api unit tests, 142 e2e tests
   total, all green.
5. 9 web component tests updated for the grouped shape, including
   expand-to-reveal assertions for both the free-preview group and a
   logged-in visitor's full view — 125 web tests total.
6. Live-verified against the real `kind` cluster, both via a direct
   API check and a real headless-browser (Playwright) run against the
   exact company/data the report was about: the Reviews section
   correctly showed "2 reviews," the free-preview group displayed
   "SSE" collapsed by default, expanding it revealed all 3 rated
   rounds (2 Coding + 1 Tech Screening), and the second, unrelated
   submission stayed properly gated for the anonymous visitor — zero
   console errors throughout.

## What this enabled

The last remaining flat list in the app — the one place a candidate's
own multi-round experience could still read as more reviews than it
actually was — now groups correctly, closing out the same class of
gap #315 already closed for moderators.
