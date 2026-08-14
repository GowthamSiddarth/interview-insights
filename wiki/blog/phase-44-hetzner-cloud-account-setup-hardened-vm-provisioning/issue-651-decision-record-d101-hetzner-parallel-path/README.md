# Phase 44, Issue #651 — Decision Record (D101): Hetzner Cloud as a Parallel Low-Cost Provisioning Path

*Part of Phase 44 — Hetzner Cloud: Account Setup & Hardened VM
Provisioning. See `docs/ROADMAP.md` Phase 44 and `docs/DECISIONS.md`
D101.*

## The gap this closed

#639/#643 already provisioned and verified the Hetzner VM — this issue
is the decision record explaining *why*, written and filed once the
reasoning had actually played out rather than as an upfront proposal.
D9's own instinct ("don't sit idle waiting on infrastructure you don't
control") had already been applied in practice; D101 is where that
reasoning gets written down so it doesn't have to be re-derived the
next time someone asks why this project runs infrastructure on three
cloud providers instead of one.

## The cost comparison that started it

Before Hetzner entered the picture at all, an AWS-vs-OCI cost comparison
had been run for Phase 8's actual target architecture — Kubernetes +
Postgres + OpenSearch + a Kafka-compatible bus, at lean-launch scale.
OCI came out roughly 2.5x cheaper than AWS, and the gap was mostly
structural fees rather than raw compute pricing: EKS's flat control-plane
charge, AWS's NAT Gateway, and AWS's 100GB egress free tier against
OCI's 10TB. That comparison is *why* #501 targeted Oracle's Always Free
A1.Flex tier for the CI runner in the first place.

What the comparison didn't capture is that "cheaper on paper" and
"available in practice" are different questions — A1.Flex turned out to
be capacity-constrained, with #501 stuck on "out of host capacity" for
over a week by the time this decision got made.

## Why Hetzner, and why Nuremberg not Ashburn

Hetzner entered as a third option specifically because it's cheaper than
both AWS and OCI at this scale *and* provisions instantly, with no
capacity queue to get stuck behind. The one wrinkle — already hit
directly during #639/#643's own work — is that Hetzner's cheap
Cost-Optimized tier (CX33, 4 vCPU / 8 GB / 80 GB, ~$9.99/mo) is
EU/Singapore-only; an initial scoping to Ashburn, VA only exposed the
Regular Performance tier at ~$41.99/mo for the same spec. Nuremberg
(`nbg1`) was the corrected choice once checked against the live console.

AWS Lightsail was also considered, specifically because staying inside
AWS's own ecosystem avoids taking on a third vendor relationship at all.
It priced out at roughly 4.4x Hetzner for a comparable spec (2 vCPU / 8
GB / 160 GB at $44/mo versus Hetzner's 4 vCPU / 8 GB / 80 GB at
$9.99/mo), and its dedicated free trial had been discontinued for AWS
accounts created after 2025-07-15 — ruled out on cost, not on principle.

## The boundary against D11

The one thing this decision record exists specifically to be explicit
about: **Hetzner does not change or supersede D11.** AWS remains the
target for Phase 8's real production build-out. Hetzner is a parallel,
low-cost pilot track only — Phase 44 (this phase, provisioning) and
Phase 45 (app-hosting on top of it) — adopted because Phase 8 hasn't
triggered yet, and this project's own instinct is to keep moving on
infrastructure it can actually get its hands on rather than wait on a
queue for infrastructure it can't.

**Revisit when:** Phase 8's own AWS build-out actually starts under
D11, or if the pilot's traffic/reliability needs outgrow what one
Hetzner box can reasonably serve.

## Closing on file

Like #643, this issue produced no code change — the decision was
already acted on by the time it was written down (Phase 44's VM was
already provisioned and verified). Closed once D101 itself landed in
`docs/DECISIONS.md` via #652, alongside the Phase 44/45 roadmap
entries.
