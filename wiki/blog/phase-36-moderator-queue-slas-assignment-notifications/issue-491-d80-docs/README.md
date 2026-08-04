# Phase 36, Issue #491 — Docs: Resolve D80, Update DATA_MODEL/ARCHITECTURE

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

Phase 36's three open questions — SLA clock start, assignment model,
breach-notification channel — were resolved during the phase's own
2026-07-31 kickoff planning pass, but only as a "still open" placeholder
line in `docs/DECISIONS.md` pointing at this issue. `docs/DATA_MODEL.md`
had grown a `claimed_by → moderators` foreign-key reference (#486)
without the `moderators` table itself ever getting documented. This
issue writes both up properly, once every other Phase 36 issue's actual
implementation exists to write about accurately.

## Key concept: writing the decision up after the fact, deliberately

Every other Phase 36 issue's own migration comments already cited "D80"
as their rationale before D80 existed as a real entry — the planning
pass settled the reasoning on 2026-07-31, but writing the full
`### D80` prose was explicitly deferred to this cleanup issue rather
than blocking #485-#490's implementation on it. That's a real, intended
sequencing choice this project uses elsewhere too (D81's own addendum
was written after implementation surfaced two gaps the original
brainstorm hadn't anticipated) — the decision record documents what was
actually built and why, not a speculative plan written before any code
existed to test it against.

## Key concept: a design gap that only became visible during implementation

The original 2026-07-31 planning pass settled manual-claim-only
assignment as the model, but didn't anticipate its sharpest edge: an
entry that breaches its SLA while still unclaimed has no notification
recipient at all. That surfaced concretely while building #488/#489,
not during planning — D80 documents it as a deliberate, accepted
consequence (the breach event still fires either way, for
observability) rather than a bug to retroactively fix, and names the
actual trigger for revisiting it: a second moderator existing, which is
also what would make auto-assignment worth designing for real.

## Key concept: filling in a table that only ever existed as someone else's foreign key

`docs/DATA_MODEL.md` documented `claimed_by | uuid FK → moderators` from
the moment #486 added the column — but `moderators` itself, introduced
by #485, had never gotten its own section. A reference pointing at
nothing was easy to miss because the FK annotation still *reads* as
complete; it just never told you what the referenced table actually
looked like. This issue adds the missing `### moderators` section
directly, positioned before `moderation_queue` so a reader hits the
referenced table before the reference.

## Step-by-step: what actually got built and verified

1. `docs/DECISIONS.md`: new `### D80` entry (SLA-clock-start, manual-
   claim-only assignment plus its unclaimed-breach consequence,
   email-via-notification-service, and the best-effort/no-retry
   breach-stamping tradeoff from #488) — replacing the "still open"
   placeholder line.
2. `docs/DATA_MODEL.md`: new `### moderators` table section;
   `breach_notified_at` added to the existing `moderation_queue`
   section.
3. `docs/ARCHITECTURE.md`: `SlaBreachDetectionService` added to the
   `api` subgraph in the system-overview diagram; `moderators`/
   `sla_breach` mentioned in the Postgres/Redpanda node labels;
   `notification-service`'s component-inventory row updated for its
   new subscription and `Moderator` mirror model.
4. Docs-only — no code changes, no tests to run. Merged once CI
   (lint/build/typecheck across every package, which a markdown-only
   change still exercises) passed, per this project's standing
   auto-merge-docs-only-PRs convention.

## What this enabled

Phase 36's actual design reasoning is now discoverable the same way
every other phase's is — a future reader (or a future session picking
up Phase 36-adjacent work) can find *why* assignment is manual-claim-
only, and why an unclaimed breach goes unnotified, without having to
reconstruct it from migration comments or git history. This also
closes out the phase itself: with #485-#491 all merged, only this post
— the engineering blog, #492 — remained.
