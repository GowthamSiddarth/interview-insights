# Phase 44, Issue #643 — Run `terraform apply`; Verify SSH Hardening on the Hetzner VM

*Part of Phase 44 — Hetzner Cloud: Account Setup & Hardened VM
Provisioning. See `docs/ROADMAP.md` Phase 44 and `docs/DECISIONS.md`
D101.*

## The gap this closed

#639 wrote and merged the Terraform, but writing infrastructure-as-code
and actually running it against a live account are different claims.
This issue is the record of the real provisioning run: `HCLOUD_TOKEN`
exported locally (never committed), `terraform apply` executed against
`infra/terraform/hetzner/`, and the resulting box's hardening confirmed
against the live server rather than just read off the cloud-init
template.

## Catching the pricing tier mismatch before `apply`, not after

#639's original scope — CX32 in Ashburn — had already been flagged as
wrong once the Terraform was written, but this issue is where it
actually mattered: running `terraform plan` against the live Hetzner
console surfaced that `cx32` had been renamed out of existence, and that
Ashburn's server list didn't include the Cost-Optimized tier at all,
only the ~4x-pricier Regular Performance tier for the same 4 vCPU / 8 GB
spec. Both `main.tf`'s defaults were corrected to `cx33`/`nbg1` (Nuremberg)
*before* `apply` ran — catching a live pricing/availability mismatch at
`plan` time is the entire reason to run `plan` before `apply` rather
than trusting whatever was written weeks earlier, even when the code
itself looks obviously correct.

Confirmed against the console: CX33 in `nbg1` at ~$9.99/mo, the same
number `variables.tf`'s own comment already predicted.

## Verifying the hardening actually took

Four checks, each against the live server rather than inferred from the
cloud-init template:

- `ssh deploy@<ip>` succeeds with the generated key — the non-root user
  and its SSH key both work.
- `ssh root@<ip>` is refused outright — "Permission denied (publickey)",
  no password prompt offered at any point.
- Password authentication is refused server-side, not just
  client-side-preferred — a client run with `PubkeyAuthentication=no`
  forcing the client to *only* try password auth never received a
  password prompt either, which is the actual proof `PasswordAuthentication
  no` took effect in `sshd_config`, rather than just that the client
  happened to prefer key auth.
- The dedicated `deploy` user, not `root` or the implicit cloud-init
  user, is the one actually granted access — the box has no login path
  that bypasses the hardening `cloud-init.yaml.tpl` set up.

Every check passed on the first live run — nothing about `cloud-init`'s
`runcmd` ordering (SSH key added before password auth/root login get
disabled, see #639) needed a second attempt.

## Closing on file

This issue produced no code change of its own — #639 already had
everything the box needed. Closed once the four checks above were
confirmed against the real VM, which is also the moment Phase 44's
actual deliverable (a reachable, hardened server) started existing,
as distinct from Terraform that merely describes one.
