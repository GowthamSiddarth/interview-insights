# Phase 46, Issue #659 — Open Ports 80/443 in the Hetzner Cloud Firewall

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A.*

## The gap this closed

Phase 44's `hcloud_firewall.ssh_only` did exactly what its name says —
inbound traffic restricted to port 22 only, a deliberate "don't expose
what nothing needs yet" choice (D9's same instinct) made before this
project had any real workload to serve. Once the pilot needed to
actually be reachable, that firewall became the literal blocker: TLS
issuance (#662) and the reachability check in #648 both need 80/443
open at the network layer, not just inside the cluster.

## An in-place rule addition, not a resource rename

```hcl
resource "hcloud_firewall" "ssh_only" {
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}
```

The resource's own Terraform address (`ssh_only`) stayed unchanged
despite now carrying three rules, not one — a deliberate choice so
`terraform apply` sees an in-place rule addition rather than a
destroy/recreate of the whole firewall resource. Confirmed via
`terraform plan` before applying: `1 to change`, not `1 to destroy, 1
to add`.

## Verification

```
terraform plan   # confirmed: in-place update, not a replace
terraform apply

nc -zv <vm-ip> 22   # still open
nc -zv <vm-ip> 80   # now open
nc -zv <vm-ip> 443  # now open
```

All three confirmed reachable at the network layer immediately after
apply — though at this point in the sequence, nothing was actually
*listening* on 80/443 yet (that's #661's ingress-nginx installation) —
this issue's own scope was strictly the firewall layer, verified as
such.
