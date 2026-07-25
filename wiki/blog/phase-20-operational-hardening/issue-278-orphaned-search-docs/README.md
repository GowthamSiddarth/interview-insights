# Phase 20, Issue #278 — 415 Ghosts in the Search Index

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Epic #214 and milestone #17 reopened and re-closed the same day, same
precedent already set twice this phase (#222, #240). See
`docs/ROADMAP.md` Phase 20 and `docs/DECISIONS.md` D51.*

## Why this is the same bug class as D35/D43, just in a different store

D35 and D43 both found a disk that quietly filled up because a deploy
loop kept adding data (Docker layers, containerd images) with no
matching removal path. This is the same shape of problem, in
OpenSearch instead of a filesystem: the `companies` index only ever
grows, because indexing (D16) happens on create and nothing has ever
run on delete. The trigger wasn't a deploy loop this time — it was
every past live-verification session across this entire project's
history that created a test company directly, checked what it needed
to check, then cleaned up by deleting the Postgres row and moving on.

## Key concept: the manual step already existed — it just wasn't reliable

This isn't a case of nobody having thought about it. D44's own
`wiki/deployment-guide.md` section 6.2 checklist already named "delete
the company's OpenSearch document too" as a cleanup step. The gap
wasn't a missing instruction, it was that the instruction was a manual
step, repeated by hand across dozens of separate verification sessions
spanning many phases, and it evidently got skipped often enough that
415 orphaned documents accumulated silently — 420 total documents
against 5 real Postgres rows. Nobody noticed because a search index
degrading slowly, one missed cleanup at a time, produces no crash and
no alert — just results that look a little worse each time, until a
user actually searches for something common enough ("co") to surface
20 identical ghosts at once.

## Key concept: diff against the source of truth before deleting anything

OpenSearch is explicitly a derived store here (D16/D17) — Postgres is
the source of truth. That made the fix mechanically simple: fetch
every company ID from Postgres, fetch every document ID from the
`companies` index, and anything in the second set not in the first is
provably safe to delete. No heuristics, no guessing at which
"Profile Co" entries looked stale — a full ID diff either has a
matching Postgres row or it doesn't. Verified the diff had zero false
positives before deleting anything: every one of the project's own
real company IDs had a matching document, confirming the 415 orphans
were genuinely orphans and not, say, a replication lag artifact.

## Key concept: a script replaces trust in a checklist, not the checklist itself

The fix isn't "remember to do the manual step better next time" — that
was already the standing expectation and it didn't hold up across
enough repetitions. `api/scripts/prune-orphaned-company-search-docs.js`
does the same diff-and-delete mechanically: `--dry-run` shows exactly
what it would remove, a real run bulk-deletes it via OpenSearch's Bulk
API. It's deliberately **not** wired into CI or any automated job —
company deletion itself is always a manual, deliberate test-cleanup
action (there's still no `DELETE /companies` in the app, and there
shouldn't be one), so pruning its fallout stays a manual, deliberate
action too. The difference is that the action is now "run one command"
instead of "remember to hand-delete the right document ID," which is
exactly the kind of step that's easy to skip under time pressure and
easy to get right every time once it's a script.

## System design approach

```js
// diff: anything in OpenSearch with no matching Postgres row is an orphan
const postgresIds = new Set(companies.map(c => c.id));
const orphanedIds = searchHits.map(h => h._id).filter(id => !postgresIds.has(id));

// --dry-run: print them
// real run: bulk-delete via the OpenSearch Bulk API (NDJSON body)
```

`npm run prune:orphaned-company-search-docs -- --dry-run` and the
plain form (no flag) are both documented directly in
`wiki/deployment-guide.md` section 6.2, alongside the existing D44
checklist it strengthens rather than replaces.

## Step-by-step: what actually got diagnosed, fixed, and verified

1. A user-facing report ("why this stale data again?") on a `/search`
   query for "co" showing one real company and nine identical
   "Profile Co" ghosts.
2. Confirmed via direct OpenSearch queries that the `companies` index
   held far more documents than expected, then did a full sweep:
   `_count` on the index versus `SELECT count(*) FROM companies` —
   420 vs. 5.
3. Diffed every document ID against every real Postgres company ID
   (`comm -23`/`comm -12`) — 415 with no match, 5 with a match, zero
   ambiguous cases.
4. Deleted the 415 confirmed orphans via the OpenSearch Bulk API,
   `_refresh`'d the index, and re-confirmed the count landed at
   exactly 5 — matching Postgres 1:1.
5. Built `prune-orphaned-company-search-docs.js`, tested it twice:
   once against the now-clean state (0 orphans, correct no-op), once
   against a deliberately-inserted fake orphan (`--dry-run` detected it
   without deleting; a real run deleted exactly that one document and
   nothing else).
6. Updated `wiki/deployment-guide.md` section 6.2 to reference the
   script as the recommended way to run that checklist's OpenSearch
   cleanup step going forward.

## What this enabled

`/search` results now genuinely reflect what companies exist, and
future live-verification sessions have a one-command way to keep it
that way instead of relying on a manual step across an ever-growing
number of past sessions. The broader lesson, consistent with D35/D43:
any store that only ever gets written to during routine work, but
never gets cleaned up by anything automatic, will eventually
accumulate enough drift to become user-visible — the fix in all three
cases was giving the cleanup a script, not just a stronger reminder.
