# Phase 7, Issue #27 — Base K8s Manifests for Postgres & OpenSearch

*Part of Phase 7 — Kubernetes. See `docs/ROADMAP.md` Phase 7,
`docs/ARCHITECTURE.md` "Deployment shape".*

This post goes deep by request — StatefulSets, PVCs, and the two real
bugs found here are concepts that recur in almost any "run a stateful
service on Kubernetes" problem, well beyond this project.

## Why this came first

Every prior phase's local infrastructure ran on Docker Compose (Phase
1.3, extended through Phase 5 and Phase 6). Kubernetes is a genuinely
different orchestration model — Compose starts and stops containers on
one machine; Kubernetes schedules, reschedules, and self-heals pods
across a cluster, with its own primitives for identity, storage, and
networking. Issue #27 is where this project's stateful dependencies
(Postgres, OpenSearch) move onto that model for the first time, and where
the manifests `api`/`web` (issue #28) will need already have to exist.

## Core concept: Deployment vs. StatefulSet, and why it matters here

Kubernetes' most common workload primitive, a `Deployment`, treats its
pods as interchangeable — any pod can be replaced by any other, in any
order, with no persistent identity. That's exactly wrong for a database:
Postgres's data directory has to survive a pod being rescheduled onto a
different node, and if you ever run more than one replica, each one
needs its *own* stable storage, not a shared one all replicas fight over.

A **`StatefulSet`** is Kubernetes' primitive specifically for this: each
pod gets a stable, predictable identity (`postgres-0`, not a random
suffix), and — critically — a `volumeClaimTemplates` block that
provisions a distinct `PersistentVolumeClaim` **per pod**, which survives
that specific pod being deleted and recreated:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres      # must reference a headless Service (below)
  replicas: 1
  volumeClaimTemplates:
    - metadata: { name: postgres-data }
      spec:
        accessModes: ["ReadWriteOnce"]
        resources: { requests: { storage: 1Gi } }
```

A `StatefulSet` also requires an associated **headless Service**
(`clusterIP: None`) — a Service with no single virtual IP of its own,
which instead resolves via DNS directly to its pods' individual IPs. This
is what gives each pod (and, with a single replica as here, the Service
name itself) a stable, predictable in-cluster DNS name — `postgres` — that
issue #28's `api` Deployment can point `DATABASE_URL` at, unchanged,
regardless of which node the pod is actually scheduled on or how many
times it's been rescheduled.

```yaml
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec:
  clusterIP: None            # headless
  selector: { app: postgres }
  ports: [{ port: 5432, targetPort: 5432 }]
```

## Two real bugs, both invisible under Docker Compose

Both of the following are the kind of bug that a Docker-Compose-only
project would simply never surface, because Compose's container/volume
model doesn't reproduce the specific conditions that trigger either one
— genuinely useful to know in advance for anyone moving a Compose-based
project to Kubernetes for the first time.

### Bug #1 — a PVC's mount root isn't a clean filesystem root

`initdb` (Postgres's own database-initialization step, which the
official image runs automatically on first start if its data directory
is empty) refuses to initialize directly into a directory that already
contains anything — including filesystem-reserved entries a completely
fresh volume can still have, such as a `lost+found` directory
(ext4/most Linux filesystems reserve this at the root of any new
volume for fsck recovery). A Docker Compose bind-mount or named volume
on a developer's Mac typically doesn't expose this, because Docker
Desktop's volume backend doesn't create a `lost+found` the same way a
real Kubernetes cluster's underlying storage provisioner does — which is
exactly why this bug is invisible until you actually run against real
Kubernetes-provisioned storage (here, `kind`'s `local-path` provisioner).

**The fix, and the general, portable lesson**: never point `PGDATA` (or
the equivalent data directory for any database image) directly at a raw
volume mount root. Point it at a subdirectory instead:

```yaml
env:
  - name: PGDATA
    value: /var/lib/postgresql/data/pgdata   # not /var/lib/postgresql/data
volumeMounts:
  - name: postgres-data
    mountPath: /var/lib/postgresql/data       # the PVC mounts here, unchanged
```

This is a widely-applicable pattern for *any* containerized database
running on Kubernetes-provisioned storage, not specific to Postgres or to
this project — the official Postgres Docker image's own documentation
recommends exactly this subdirectory pattern for this reason.

### Bug #2 — `vm.max_map_count` and JVM-based search engines on Kubernetes

OpenSearch (like its ancestor Elasticsearch) is a Java application that
memory-maps a large number of index files, and needs the Linux kernel's
`vm.max_map_count` setting raised well above most systems' default
(65530) — OpenSearch's own startup check refuses to run below roughly
262144. This is a **host-kernel** setting, not a per-container one — it
has to be raised on the actual node OpenSearch's pod lands on, which a
regular pod has no permission to do on its own.

The fix is a well-established Kubernetes pattern, not something specific
to this project: a **privileged `initContainer`** that runs before the
main container and sets the sysctl directly:

```yaml
initContainers:
  - name: sysctl
    image: busybox:1.36
    command: ["sysctl", "-w", "vm.max_map_count=262144"]
    securityContext:
      privileged: true
```

This is worth understanding as a reusable pattern in its own right:
**an `initContainer` runs to completion before any of a pod's main
containers start**, making it the standard place to do one-time setup a
pod's real workload needs but shouldn't have the permissions to do
itself — here, a privileged host-kernel tweak; elsewhere, waiting for a
dependency to become reachable, or running a database migration before
the app container starts.

A third, related, non-bug-but-worth-naming detail: OpenSearch's container
**memory limit was set deliberately higher than its JVM heap size**
(`limits.memory: 1536Mi` against a `-Xmx512m` heap configured via env).
A JVM's heap is only part of its real memory footprint — off-heap
structures, native memory, and OS-level page cache for memory-mapped
index files all add up on top of it. Setting a container memory limit
too close to the heap size is a classic way to get a JVM-based workload
OOMKilled by Kubernetes under real load, even though the JVM itself
believes it has headroom — the container's `cgroup` limit and the JVM's
own heap accounting are two independent things that both have to be
sized with the other in mind.

## Step-by-step: what actually got built

1. **Installed `kind`** (Kubernetes-in-Docker) as the local cluster
   tooling — the "install locally, ask before adding a new tool" pattern
   this project used previously for Docker and `gh`.
2. **Wrote `infra/k8s/base/00-namespace.yaml`** — everything in this
   phase lives in its own `interview-insights` namespace, isolating it
   from anything else that might run in the same cluster later.
3. **Wrote `01-postgres-secret.yaml`** — plaintext credentials, explicitly
   acceptable only because this targets local `kind`/`minikube`; real
   secret management is gated on Phase 8b's actual trigger (a real shared
   environment existing).
4. **Wrote `02-opensearch-config.yaml`** — a `ConfigMap` mirroring
   `infra/docker-compose.yml`'s OpenSearch env exactly (single-node,
   security plugin disabled), so the two environments' OpenSearch
   behaves identically.
5. **Wrote `03-postgres.yaml`** — the headless `Service` + `StatefulSet`
   shown above, including the `PGDATA` fix.
6. **Wrote `04-opensearch.yaml`** — the same shape, plus the privileged
   `initContainer` and the deliberately-sized memory limit.
7. **Numbered every manifest file** (`00-`, `01-`, ...) — `kubectl apply
   -f infra/k8s/base/` applies files in a directory in filename order in
   practice, and the namespace genuinely has to exist before anything
   referencing it does; numbering makes that ordering explicit and
   robust rather than incidental.
8. **Verified against a real local cluster, not just `kubectl apply`
   succeeding**: both StatefulSets reached `1/1 Running` with PVCs
   `Bound`; port-forwarded to each and confirmed real connectivity
   (`psql`, `curl .../_cluster/health`); then — the check that actually
   proves the PVC is doing its job, not an `emptyDir` silently standing
   in for it — inserted a marker row, deleted the `postgres-0` pod
   outright, waited for the StatefulSet to recreate it, and confirmed
   the row was still there. A pod merely restarting successfully doesn't
   prove persistent storage works; only surviving an actual pod deletion
   does.

## What this enabled

Issue #28's `api` Deployment references `postgres` and `opensearch` by
their plain Service names (`DATABASE_URL: postgresql://postgres:postgres
@postgres:5432/...`, `OPENSEARCH_URL: http://opensearch:9200`) with zero
additional networking configuration — the headless Services built here
are exactly what makes that work, unchanged regardless of which node
either pod actually lands on. Both real bugs found here (the PVC mount
subdirectory, the sysctl initContainer) are also genuinely reusable
knowledge for running *any* Postgres or OpenSearch/Elasticsearch
deployment on Kubernetes, not specific to this project at all.
