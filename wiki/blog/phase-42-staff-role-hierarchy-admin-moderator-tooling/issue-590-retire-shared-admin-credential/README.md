# Phase 42, Issue #590 — Retiring the Shared Admin Credential for the General Case

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

By the time #589 merged, the shared credential's actual job had already
shrunk to almost nothing — every account could now be created
individually, with its own password, through real admin tools. What
hadn't caught up was everything *describing* the system: a rotation
script whose own comments still framed it as "the admin login" in
general, a deployment-guide section documenting it the same way, and a
web page whose copy stated an assumption ("single shared admin
credential") that had just stopped being true. This issue was entirely
about closing that description gap — no schema, no new endpoint,
nothing behavioral changed here that #589 hadn't already changed.

## Key concept: the mechanism didn't need to change, only what it's *for*

`rotate-admin-credentials.sh` was never, even before this issue, capable
of touching any account but the one root identity — it only ever reads
and writes `ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`, which is exactly
and only the root's own env-sourced credential. So "narrowing" this
script didn't mean changing what it does; it meant making the header
comment say what it had always actually been true of, and pointing
anyone who reaches for it out of habit toward the tools that now exist
for the general case:

```bash
# Root-admin credential rotation — break-glass recovery ONLY (GitHub
# issue #590, Phase 42, D99, narrowing the scope this script had under
# #192, Phase 18). ... For every other case, use the tools #589 built
# instead:
#   - New staff account (any role): an existing ADMIN, via
#     POST /admin/staff ... never this script.
#   - Forgot your own password (any role): self-service
#     POST /auth/admin/change-password, or ask an existing ADMIN to
#     POST /admin/staff/:id/reset-password for you.
#   - Locked out entirely and no ADMIN is reachable to help: THAT is
#     what this script is for.
```

That last bullet is the actual reason this account stays on the
imperative-secret path rather than moving into the normal
`moderators`-table password-reset flow #589 built for everyone else: it
has to be recoverable even in the worst case, where every other account
has been deactivated or is unreachable. Nothing about that worst-case
role changed — this issue just made the script say so explicitly instead
of leaving a future reader to infer it.

## Key concept: stale documentation is a real defect, just a quiet one

`wiki/deployment-guide.md` section 5b's closing line read "matching this
project's single-admin, single-credential scope" — true when Phase 18
wrote it, false as of #589, and silently misleading to anyone who read
it after that point without knowing to distrust it. The fix wasn't
deleting the observation (the fact that the *old* password stops working
the instant `api` restarts is still true and still worth documenting) —
it was scoping the claim correctly: specific to the one root identity
this section covers, explicitly not a statement about every other staff
account, which is an ordinary `moderators` row unaffected by a
root-credential rotation. Same treatment for `web/src/app/moderation/
login/page.tsx`'s subtitle: "Moderation queue access — single shared
admin credential" became "Staff login — admin, moderator, and staff
accounts," a one-line change with no behavioral effect but a real
accuracy one — anyone reading that page for the first time after this
phase shipped would otherwise have been told something false about the
system they were logging into.

## Verification

`bash -n` on the rotation script confirmed the comment-only edit didn't
break anything syntactically. The one line of UI copy has no test
asserting its exact text (confirmed by grep before changing it), so no
test needed updating; `npx jest tests/moderation-login-page.spec.tsx`
still passed. `npx tsc --noEmit` and `npm run lint` clean on the web
side. No CI-relevant application code touched at all — this issue's
entire diff is two comment blocks and one JSX string.
