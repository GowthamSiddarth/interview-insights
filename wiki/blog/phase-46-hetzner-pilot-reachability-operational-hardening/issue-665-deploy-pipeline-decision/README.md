# Phase 46, Issue #665 — Decide the Deploy Pipeline to the Pilot

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A.*

## The gap this closed

Two genuinely different paths existed for getting a deploy onto the
pilot: manual, via the runbook (#649) — an operator running commands by
hand each time — or a real second CD job, alongside `cd.yml`'s existing
kind/local target. Building `overlays/hetzner-pilot` (#646) and the
image-delivery path (#660) without first deciding which of these it
needed to serve would have risked designing for the wrong shape.

## Decision, scope, and precedent

Resolved to a CD job — `cd-hetzner.yml` (#708) — matching a
decision-vs-implementation split this project already uses elsewhere
(D82/#500 vs. #501-505's own Oracle-runner provisioning). This issue's
own scope stopped at the decision itself, deliberately: "decide and
document," not "build." The actual workflow is #708's job, informed by
this issue's outcome but implemented separately.

## Why a CD job, not staying manual

A pilot meant to be redeployed repeatedly (bug fixes, new features,
the ordinary cadence of this project's own development) benefits from
the same automation discipline `cd.yml` already gives the local `kind`
target — a manual runbook works for a one-time provisioning step, but
turning every future code change into a hand-run sequence of `kubectl`
commands doesn't scale past the first few deploys, and this project's
whole CI/CD posture (Phase 6, Phase 12) already treats automated deploy
as the default, not the exception.

## What it informed downstream

This decision fed directly into #649 (the runbook only needed to
document *triggering* a deploy and *recovering* from one going wrong,
not every individual step of running one by hand) and #708 (the actual
workflow this issue's decision specified).

## Verification

A decision issue has no code path to smoke-test — its own acceptance
criterion was simply resolving the question with a documented
rationale, which this post (and the issue's own comment history) is
that record. The real proof came later: #708 built exactly what this
issue decided on, and #648 confirmed that workflow actually works end
to end against the live pilot.
