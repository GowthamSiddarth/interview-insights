# Phase 52, Issue #783 — Staff Email Has No Documented PII-Handling Rationale

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

`candidates.email` gets real cryptographic treatment: never stored raw,
only as an HMAC hash (`email_hash`, for lookup) plus a separately-keyed
AES-256 encrypted value (`email_encrypted`, for the rare cases the app
needs to actually send mail). `moderators.email`, by contrast, is a
plain text column — no hash, no encryption, nothing. Read cold, without
context, that asymmetry looks like an oversight: two email columns in
the same schema, one heavily protected, one not, with nothing on record
explaining why that's intentional rather than a gap someone forgot to
close.

The audit flagged it as a documentation gap specifically — not a code
change, since the actual security question ("is this the right level of
protection for this data") needed answering and recording, not a
default assumption that more encryption is always better.

## The fix: write down why the asymmetry is correct

The candidate-email rigor exists for a specific, narrow reason (D34
design principle 1: "never store raw candidate identity") that traces
back to what a `Candidate` actually *is* in this system — an external,
self-registered person whose data is in scope for GDPR erasure
(`MeService.eraseMe()`). Every axis that motivates that rigor is absent
for `Moderator`:

- **Provisioning**: a candidate self-registers with any email they
  choose; a moderator account is admin-provisioned only — there's no
  path for an arbitrary person to end up with a `moderators` row at all.
- **External vs. internal**: a candidate is someone outside this
  organization; a moderator is staff.
- **GDPR erasure**: `Candidate` rows are erasable on request; nothing
  analogous exists (or should exist) for an internal staff account.

None of that is new reasoning invented for this issue — D34 already
established it for candidates. What was missing was writing the
*negative* case down: confirming explicitly that the absence of
equivalent protection for `moderators.email` was evaluated and rejected
as unnecessary, not simply never considered. Recorded in two places —
`docs/DATA_MODEL.md`'s `moderators.email` column entry, and a dedicated
paragraph in `docs/SECRETS.md`'s inventory table (which lists every
actual secret in the system) making the negative explicit: "Staff email
has no equivalent secret, deliberately."

## Verification

Documentation-only — no code, no tests, no runtime behavior change.
Verified by cross-referencing both new callouts against D34's original
reasoning to confirm they accurately restate it rather than inventing a
new justification, and by confirming `docs/SECRETS.md`'s secret
inventory table (used elsewhere in this project as the audit trail for
"which pattern does this credential follow") stays internally consistent
with the explicit "no equivalent secret" note now sitting right below it.
