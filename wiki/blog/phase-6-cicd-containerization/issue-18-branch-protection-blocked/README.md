# Phase 6 Hardening, Issue #18 — Branch Protection (Blocked)

*Part of Phase 6 — CI/CD & containerization. See `docs/ROADMAP.md` Phase 6.*

Every other post in this series documents something that got built. This
one documents something that was investigated thoroughly, found to be
genuinely infeasible under current constraints, and deliberately left
**open, not closed** — which is itself worth understanding as a distinct,
legitimate outcome of engineering work, not a failure to write up.

## Why this came first

CI (`.github/workflows/ci.yml`) has run lint/build/test on every PR since
Phase 1 — but nothing *enforced* that those checks had to pass before a
PR could merge, or that every change even went through a PR at all. This
project's own working convention ("always branch + PR, never commit
directly to main") had been followed by discipline alone up to this
point, not by anything GitHub itself would refuse to let happen if that
discipline slipped. Issue #18's goal was to make that discipline
platform-enforced.

## Key concepts

- **There are two different GitHub mechanisms for this, and this issue
  tried both.** Classic **branch protection rules**
  (`PUT /repos/{owner}/{repo}/branches/{branch}/protection`) are the
  older, per-branch API. **Repository rulesets**
  (`POST /repos/{owner}/{repo}/rulesets`) are the newer, more flexible
  replacement, letting rules apply across multiple branches by pattern.
  Both were attempted here, not just one, specifically to rule out "maybe
  the newer API doesn't have this limitation" before concluding the
  feature itself was unavailable.
- **A real, load-bearing distinction: a platform limitation confirmed by
  directly calling the API, versus one merely assumed from documentation
  or reputation.** It would have been easy to assume branch protection
  requires a paid plan based on general GitHub pricing-page knowledge and
  stop there. Instead, both endpoints were called directly against this
  actual repository, and the actual response was read: a `403` with the
  literal message "Upgrade to GitHub Pro or make this repository public."
  That's a materially stronger claim than "I believe this requires a paid
  plan" — it's "I asked GitHub directly, for this specific repository,
  and this is the exact error it gave."
- **"Blocked" is a legitimate, first-class outcome — not a failure to
  document, and not something to quietly drop.** The issue was left
  **open** on GitHub, with the blocker explained directly in an issue
  comment, rather than closed as if it were done, and rather than deleted
  as if it never mattered. This preserves the actual project history: a
  future reader (including a future session of this same project) can
  see exactly what was tried, why it didn't work, and what would need to
  change for it to become possible — instead of either a misleading
  "closed" status implying success, or silence implying it was never
  attempted.

## The two constraints, and why they're actually the same tradeoff

Both routes to platform-enforced branch protection require one of two
things this project doesn't currently have: a paid GitHub plan, or a
public repository. That's not a coincidence or an arbitrary GitHub
policy quirk — it reflects a genuinely reasonable tradeoff GitHub is
making: branch protection exists primarily to protect a codebase multiple
people (or an organization) are collaborating on from accidental or
malicious direct pushes; a solo developer on a private repository is, by
definition, the only person who could push directly to `main` in the
first place, so the *platform* enforcing a rule the *only contributor*
would have to violate against themselves is a genuinely different
value proposition than enforcing it against a team. GitHub's free tier
reflects that by gating the feature behind either "you're paying for
collaboration features" or "your repo being public means external
contributors could plausibly need protecting against."

**The important reframe this issue lands on**: the actual value this
project gets from "always branch + PR" doesn't come from GitHub
*preventing* a violation — it comes from the discipline itself producing
reviewable history, working CI feedback on every change, and a clean
audit trail. All three of those already exist and already work, purely
from following the convention voluntarily. Platform enforcement would
only add protection against forgetting or deliberately bypassing the
convention — a real but narrower benefit than the convention's main
value, which was never dependent on GitHub enforcing it in the first
place.

## Step-by-step: what was actually done

1. **Attempted classic branch protection** via
   `PUT /repos/{owner}/{repo}/branches/main/protection`, with the actual
   desired rule set (require the CI status checks, require a PR before
   merging) — got a `403` with GitHub's upgrade-or-go-public message.
2. **Attempted the newer repository rulesets API** as a second, verifying
   attempt — `POST /repos/{owner}/{repo}/rulesets` — got the identical
   `403` and message, confirming this isn't specific to the older API.
3. **Documented the exact finding** (both endpoints, the exact error
   message, confirmed by direct API calls rather than assumed) directly
   as a comment on GitHub issue #18.
4. **Left the issue open**, explicitly not closed, with a clear "revisit
   if/when the account upgrades to Pro or the repo's visibility changes"
   condition — the same "name the trigger for revisiting" discipline
   `docs/DECISIONS.md` applies to every deferred decision in this
   project (D9, D13, D15, D16), now applied to a blocked *process*
   change rather than a deferred *code* change.
5. **Reaffirmed that the underlying convention still applies day to
   day** regardless of the platform gap — CLAUDE.md's "always branch +
   PR" rule was never contingent on GitHub enforcing it, and every phase
   before and after this issue continued following it purely by
   discipline, which this issue's finding didn't change at all.
6. **Moved the issue to the project board's backlog** rather than
   leaving it in an active column — an accurate reflection of its actual
   status: not abandoned, not actively being worked, waiting on an
   external condition (a plan upgrade or visibility change) neither in
   this project's control nor expected to change imminently.

## What this enabled — or rather, what it correctly avoided

This issue didn't unlock any later work the way most issues in this
series do — its value is entirely in *not* wasting further effort trying
alternate workarounds for a genuinely platform-level gate, and in leaving
an accurate, unambiguous record for anyone (including a future version of
this project) who might otherwise re-attempt the same investigation from
scratch. The general lesson for any project maintaining a working
convention purely through discipline rather than platform enforcement:
occasionally check whether platform enforcement has become available (a
plan change, a policy change, a new feature) — but don't block progress
waiting for it, and don't let "we couldn't platform-enforce this" be
confused with "we stopped following this."
