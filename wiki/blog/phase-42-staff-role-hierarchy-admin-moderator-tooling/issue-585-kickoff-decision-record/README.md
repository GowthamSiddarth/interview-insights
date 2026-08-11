# Phase 42, Issue #585 — Kickoff Brainstorm: A Real Role Hierarchy Instead of One Shared Credential

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

An audit of the actual current state, done as this phase's own kickoff
step, found that `admin-auth` and `ModerationController`/
`AdminRoundTypeFieldOptionsController` were all gated by one `Moderator`
row backed by a single shared credential (`ADMIN_USERNAME`/
`ADMIN_PASSWORD_HASH`, from Phase 36's issue #485). "Admin" and
"moderator" were the same undifferentiated actor — there was no second
tier, no individual identity beyond the one boot-seeded row, and no way
to grant someone read-only visibility without handing them the same
credential every moderation action used. D53 had already considered and
explicitly declined extracting a `moderator-service` ("no concrete
scaling/deployment trigger has fired") — this brainstorm had to decide
whether a real role hierarchy changed that answer, or just added roles
inside the monolith that already existed.

Four concrete design questions needed resolving before #586-#592 could
be filed and implemented: what the role set actually is, how
authorization gets checked per route, how the schema represents it, and
what happens to the one shared credential once individual accounts
exist.

## Key concept: a permission set composes, a role name doesn't

The most consequential choice wasn't the role names — it was *how* a
route decides whether a given role can call it. Two shapes were on the
table:

- **Three hardcoded flat role checks**, scattered per controller —
  `if (role === 'admin' || role === 'moderator') { ... }`. Simple to
  write, but every future nuance (a moderator without PII visibility, a
  staff member who can flag but not approve) forces either a new role or
  a rewrite of every check that needs to know about it.
- **A permission-set model** — named permissions like
  `moderation:queue:approve` or `admin:staff:manage`, each role mapped
  to the set it carries, checked through one shared decorator/guard.

The permission-set model won specifically because it composes: a future
nuance becomes a new permission slotted into the existing map, not a
new role or a rewrite of every guard that currently does string
comparison against `role`. This is the same reasoning D75 already
applied to `notification-service`'s read-only Prisma mirror — design the
seam so the *next* requirement doesn't require touching every existing
call site.

## Key concept: the third tier needed a name that wasn't already taken

The role set settled at `ADMIN` > `MODERATOR` > `STAFF`, each a superset
of the one below. The obvious name for the bottom tier — `USER` — was
rejected immediately: `Candidate` is what "user" already means
everywhere else in this codebase's domain model, and reusing the word
for an unrelated internal-staff concept would collide with an
established entity rather than clarify anything. `STAFF` was chosen
deliberately as a real, shipped tier, not a placeholder: read-only access
to the moderation queue, search, the round-type registry, and
moderator/SLA analytics dashboards, with no claim/approve/reject/flag/
write permission of any kind. Its concrete job is support/onboarding/
spot-check access without moderation authority, and it doubles as a
foothold for Phase 41's parked candidate-communication-loop idea, which
needs exactly this kind of limited-visibility account and previously had
nowhere to attach to.

## Key concept: extend the existing table, don't rename it

D75's `notification-service` mirror model and every existing FK/comment
already reference `Moderator` by that name. A brand-new or renamed
accounts model would ripple into all of it for no functional gain — so
`role`/`isActive`/`createdById` were added directly onto the existing
`moderators` table instead. Deactivate, never delete, same precedent
`ModerationQueueEntry.claimedById` already set by never being cleared
once assigned. A new `staff_audit_log` table records every admin action
(account created, role changed, deactivated/reactivated, password
reset) — durable, never best-effort, the same bar `AiAutoApprovalAudit`
(D71) set for system-attributed decisions.

## Key concept: retiring a shared secret without breaking the one thing that has to survive a total lockout

The credential model needed to solve a specific bootstrapping problem:
once individual accounts exist, the general case should never again
require sharing one password — but *something* has to be recoverable
even if every non-root account gets deactivated or locked out at once.
The answer: exactly one root `ADMIN` stays imperatively boot-seeded,
same secrets pattern as today (hard constraint #6). Every other account
is created through admin tools by an existing `ADMIN`, with its password
shown once at creation — the same one-time-reveal UX
`rotate-admin-credentials.sh` already established for the root account
itself. That script narrows in scope rather than disappearing: it
becomes root-admin break-glass recovery only, not deleted, since the
root identity still needs an out-of-band recovery path that doesn't
depend on any other account being reachable.

## Key concept: revisiting D53's monolith call, and reaffirming it

A real role hierarchy plus admin tooling is exactly the kind of feature
that *sounds* like it might need its own service boundary. The
brainstorm revisited D53's "no `moderator-service` extraction" call on
purpose rather than assuming it still held, and reached the same answer
for the same reason: this phase is fundamentally a role column and some
guards, not a service boundary. No cross-service auth verification, no
duplicated Prisma client, no new Dockerfile/manifest/CI job gets bought
for a feature this contained. The call is explicitly revisitable — a
real independent-scaling/deployment need, or a distinct security/
network-isolation boundary a future admin capability might need — but
neither trigger had fired at kickoff time.

## Step-by-step: what actually got resolved and written down

1. Audited the actual current state of `admin-auth`/`ModerationController`/
   `AdminRoundTypeFieldOptionsController` rather than assuming from memory
   what was already built.
2. Resolved the role set (`ADMIN`/`MODERATOR`/`STAFF`), rejecting `USER`
   explicitly for the collision with `Candidate`.
3. Resolved the authorization shape (permission-set model over flat role
   checks), with the composability reasoning written down so a future
   permission nuance has a clear place to land.
4. Resolved the schema shape (extend `moderators`, new `staff_audit_log`),
   rejecting a renamed/new accounts model for the D75 ripple cost.
5. Resolved the credential model (root stays imperative, everyone else
   goes through admin tools, `rotate-admin-credentials.sh` narrows to
   break-glass recovery).
6. Reaffirmed D53's monolith-over-service-extraction call for this
   feature specifically, with the same "no concrete trigger" bar applied.
7. Wrote all five decisions up as `docs/DECISIONS.md` D99, updated
   `docs/ROADMAP.md`'s Phase 42 section and `CLAUDE.md`'s current-status
   line. Docs-only change, no code touched — nothing to test.

## What this enabled

Every subsequent issue in this phase had a concrete target to build
toward instead of re-deriving these decisions mid-implementation: #586
knew exactly which three columns and one new table to add, #587 knew the
authorization shape was a permission map and guard rather than flat
checks, #589 knew the credential model meant server-generated,
shown-once passwords rather than a self-registration flow, and #590 knew
`rotate-admin-credentials.sh` was being narrowed, not deleted. The one
adjustment that surfaced only once implementation actually started:
#585's own kickoff PR accidentally closed the phase's tracking epic
(#584) early via its own closing keyword, rather than leaving it open
until every sub-issue merged — caught and fixed at the start of #586's
session, not something the brainstorm itself needed to get right.
