# Hetzner Cloud VM — Terraform

Provisions one hardened Hetzner Cloud server as a pragmatic parallel path
to issue #501 (Oracle Cloud A1.Flex), which is blocked on Oracle's
"out of host capacity" queue. This doesn't replace that effort — it
unblocks work now without waiting on it.

Default spec: CX33 (4 vCPU / 8 GB / 80 GB), Nuremberg (`nbg1`), Ubuntu
24.04 — **~$9.99/mo**. Override any of it via `-var` or a local
(gitignored) `.tfvars` file — see `variables.tf`.

**Why Nuremberg, not a US location:** Hetzner's cheap Shared Resources /
Cost-Optimized tier (the CX line) is only sold in EU/Singapore locations.
Ashburn/Hillsboro (US) only expose the pricier Regular Performance /
General Purpose tiers — the same 4 vCPU / 8 GB spec runs **~$41.99/mo**
in Ashburn, roughly 4x. Worth revisiting deliberately if this box ever
needs to be latency-local to US end users; not worth it for its current
job (CI runner / provisioning pilot).

## Credentials

`HCLOUD_TOKEN` is read from your shell environment by the provider's
built-in support for it. It is never a Terraform variable, never has a
default, and never appears in any `.tf` file or committed `.tfvars` —
same bar as every other credential in this project (CLAUDE.md hard
constraint #6).

Generate a token in the Hetzner Cloud Console under your Project →
Security → API Tokens, then:

```bash
export HCLOUD_TOKEN="<paste here, this shell session only>"
```

## SSH key

Defaults to `~/.ssh/hetzner-vm.pub`. The matching private key stays on
your machine — Terraform only ever reads the public half, and it never
enters state or this repo.

## Usage

```bash
cd infra/terraform/hetzner
terraform init
terraform plan
terraform apply
```

`terraform.tfstate` and any `.tfvars` you create are gitignored — state
for this project is local-only for now, matching the small, single-operator
scale this is actually being run at. Revisit remote state (an
`hcloud`-hosted or S3-compatible backend) if that stops being true.

```bash
terraform output ssh_command
terraform destroy   # tear it down when you're done with it
```

## Hardening baked into first boot

- SSH key-only auth (password auth disabled, root login disabled)
- Dedicated non-root `deploy` user (passwordless sudo, same SSH key)
- `unattended-upgrades` for automatic security patches
- `fail2ban` against SSH brute-force
- Cloud Firewall: inbound restricted to SSH (22) only — nothing else is
  exposed until a real workload needs it

No production credentials or access of any kind belong on this box until
a specific, deliberate decision says otherwise.
