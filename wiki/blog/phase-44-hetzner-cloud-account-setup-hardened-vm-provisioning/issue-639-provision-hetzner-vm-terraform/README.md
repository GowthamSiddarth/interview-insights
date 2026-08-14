# Phase 44, Issue #639 — Provision Hetzner Cloud VM via Terraform (Parallel Path to #501)

*Part of Phase 44 — Hetzner Cloud: Account Setup & Hardened VM
Provisioning. See `docs/ROADMAP.md` Phase 44 and `docs/DECISIONS.md`
D101.*

## The gap this closed

Phase 40's self-hosted CI runner (#501) had been stuck on Oracle Cloud's
Always Free A1.Flex tier since 2026-08-04 — "out of host capacity" in
the home region, with no ETA. The retry loop was still running, but
nothing else was moving. Rather than sit idle waiting on a queue this
project doesn't control, this issue provisioned a second, independent
VM on a different provider — not a replacement for the Oracle attempt,
a parallel path that unblocks work now.

`infra/terraform/` had existed as an empty placeholder directory since
early in the project. This issue wrote the first real Terraform this
repo has ever applied.

## Provider, spec, and the first pricing surprise

`infra/terraform/hetzner/provider.tf` pins the `hetznercloud/hcloud`
provider (`~> 1.48`) and Terraform itself (`>= 1.7`). The original scope
called for CX32 in Ashburn, VA (US East) — staying close to where a lot
of this project's other tooling already assumes US-based infrastructure.
That didn't survive contact with the live Hetzner console: Hetzner had
renamed the CX line, so `cx32` was no longer a valid `server_type`, and
Ashburn only carries Hetzner's pricier Regular Performance tier for a
comparable spec — about $41.99/mo versus the Cost-Optimized tier's
$9.99/mo, because the cheap tier is EU/Singapore-only. `variables.tf`
documents both defaults with the reasoning inline, not just the
corrected values, so a future reader hitting the same US-location
temptation sees why it was rejected the first time:

```hcl
variable "server_type" {
  description = "Hetzner Cloud server type (spec). CX33 = 4 vCPU / 8 GB / 80 GB, Shared Resources / Cost-Optimized tier ($9.99/mo). NOTE: this tier is only available in EU/Singapore locations — US locations (ash/hil) only expose the pricier Regular Performance / General Purpose tiers, roughly 4x the cost for the same spec."
  type        = string
  default     = "cx33"
}
```

Final spec: CX33 (4 vCPU / 8 GB / 80 GB), Nuremberg (`nbg1`), Ubuntu
24.04, ~$9.99/mo.

## Credential handling: `HCLOUD_TOKEN` never touches a file

CLAUDE.md's hard constraint #6 rules out committing any secret, real or
placeholder — including as a `.tf` variable default. The `hcloud`
provider already supports reading its token from an environment
variable, so `provider.tf` just declares the provider block empty and
leans on that:

```hcl
# No `token` attribute set here on purpose: the hcloud provider reads it
# from the HCLOUD_TOKEN environment variable automatically. Nothing
# token-shaped ever appears in a .tf file, a default, or a committed
# .tfvars — same "never baked into a committed file" bar as every other
# credential in this project (CLAUDE.md hard constraint #6).
provider "hcloud" {}
```

`terraform.tfstate` and any local `.tfvars` are gitignored (`*.tfstate`,
`*.tfstate.*`, `**/.terraform/` in `.gitignore`) — state for a
single-operator project this small stays local, not in a remote
backend, until that stops being true.

## Hardening via cloud-init, not a post-boot script

Everything the box needs to be safe on first boot lives in
`cloud-init.yaml.tpl`, templated with the admin username and public SSH
key at `terraform apply` time rather than SSH'd in afterward — the VM
is never in an unhardened state, even for the seconds between boot and
a manual follow-up:

```yaml
runcmd:
  - sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  - systemctl restart ssh
  - systemctl enable --now unattended-upgrades
  - systemctl enable --now fail2ban
```

A dedicated non-root `deploy` user gets the same SSH key as the
implicit root/cloud-init user, so disabling root login and password
auth in the same `runcmd` block doesn't risk a lockout — the working
login path already exists before those two `sed` commands run.
`hcloud_firewall.ssh_only` restricts inbound traffic to port 22 only,
at the network layer, on top of the host-level hardening — the same
"don't expose what nothing needs yet" instinct this project already
applies elsewhere (D9): nothing else gets a firewall rule until a real
workload (Phase 45's app-hosting pilot) explicitly needs one.

## Verification

Acceptance for this issue was `terraform apply` producing a reachable,
hardened VM with the credential handling and firewall rules described
above — the actual `apply` run and SSH verification became their own
follow-up (#643), since applying real infrastructure and confirming the
hardening took is genuinely separate work from writing the Terraform
that describes it.
