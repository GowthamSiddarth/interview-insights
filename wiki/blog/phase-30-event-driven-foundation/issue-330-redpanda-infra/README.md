# Phase 30, Issue #330 — Add Redpanda to Local Infra (docker-compose + k8s)

*Part of Phase 30 — Event-Driven Foundation. See `docs/ROADMAP.md` Phase
30 and `docs/DECISIONS.md` D12/D53.*

## Why this came first, and why now

`docs/ARCHITECTURE.md` has described moderation as event-driven off a
Kafka/Redpanda bus since early in the project — but D12 (Phase 3)
deliberately kept moderation in-process instead, because nothing
actually produced to that bus. Redpanda was removed from local
`docker-compose.yml` entirely (D9: standing up a consumer for a queue
nothing populates is premature infrastructure). That reasoning never
stopped being true on its own terms — there still isn't organic load
demanding an event bus. What changed is the trigger: D53 records that
the project owner explicitly wants real distributed-systems/
microservices practice, the same category of trigger Phase 10/11 already
accepted for LocalStack IAM/secrets work done purely for free/local AWS
practice, not because anything needed it yet.

Issue #330 is step one of three feature issues in this phase, and it's
scoped to exactly one thing: get a real broker running locally and in
`kind`, reachable, with nothing publishing or consuming yet. That's a
deliberate, temporarily "unused but proven reachable" state — the same
one OpenSearch briefly sat in between Phase 5 issue #21 (setup) and its
first real indexing call.

## Key concept: what Redpanda is, and why it's a drop-in for Kafka here

Redpanda is a Kafka-API-compatible streaming platform, written in C++
rather than the JVM, that speaks the same wire protocol
[`kafkajs`](https://kafka.js.org/) (the Node client this project uses)
already expects. For local dev and a single-broker `kind` cluster, the
practical draw is operational: no ZooKeeper/KRaft controller cluster to
run alongside it, no JVM to size memory for — one container, one process,
one set of ports. Nothing about the code that eventually talks to it
(issue #331) cares which broker implementation is underneath; that's the
whole point of targeting the Kafka protocol rather than a
Redpanda-specific client.

## Key concept: `dev-container` mode and single-broker `--advertise-kafka-addr`

Redpanda's own recommended mode for a lone container instance is
`dev-container` — relaxed fsync/memory defaults, no multi-broker gossip
setup attempted:

```yaml
redpanda:
  image: docker.redpanda.com/redpandadata/redpanda:v24.2.7
  command:
    - redpanda
    - start
    - --mode dev-container
    - --smp 1
    - --kafka-addr internal://0.0.0.0:9092,external://0.0.0.0:19092
    - --advertise-kafka-addr internal://redpanda:9092,external://localhost:19092
```

The internal/external listener split matters here for the same reason
it does for any brokered system a client can reach from two different
networks: a client connecting from *inside* the Docker Compose network
(a future in-cluster consumer) needs to be told to reconnect to
`redpanda:9092` — the service's own DNS name — while a client on the host
(`api` running via `npm run start:dev`, not containerized, per this
project's fast local-dev loop) needs `localhost:19092`. Getting this
wrong is a classic distributed-systems gotcha: Kafka-protocol clients
don't just connect to the address they dialed — after the initial
connection, the broker tells them which address to use for actual
produce/consume traffic (the "advertised" address), and if that
advertised address is only reachable from one side, the other side's
client hangs or fails opaquely partway through a request instead of
failing cleanly at connect time.

`infra/k8s/base/09-redpanda.yaml` mirrors the same image and command
flags exactly, but swaps the docker-compose service name for the
in-cluster Kubernetes Service name — because a headless Service
(`clusterIP: None`) with a single replica makes the Service's own DNS
name resolve straight to the one backing pod, `--advertise-kafka-addr`
can reuse the identical value shape from compose with no
per-environment templating. This is the same headless-Service pattern
`04-opensearch.yaml` already established for OpenSearch in Phase 7 — a
single-instance stateful dependency doesn't need a load-balanced
ClusterIP, since there's only ever one pod to route to.

## Step-by-step: what actually got built and verified

1. Added the `redpanda` service to `infra/docker-compose.yml`, in
   `dev-container` mode with the internal/external listener split above.
2. Added a matching headless `Service` + single-replica `StatefulSet` to
   `infra/k8s/base/09-redpanda.yaml`.
3. Documented `REDPANDA_BROKERS` in `api/.env.example`, defaulting to
   `localhost:19092` (compose's external listener) — nothing reads this
   env var yet; that's issue #331.
4. Verified reachability directly (not yet through application code,
   since none exists): `docker compose up redpanda` and confirmed the
   broker's admin API (port 9644) and Kafka API (19092) both answer from
   the host, and that the `kind` StatefulSet's pod reaches `Running` with
   its headless Service resolvable from another pod in the cluster.

## What this enabled

A real, reachable broker exists in both environments this project
deploys to, with nothing depending on it yet — so the next issue (#331)
can build the actual publishing client and event schema against a real
instance from the start, rather than mocking Kafka's wire protocol and
discovering integration gaps later.
