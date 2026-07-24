# Phase 20, Issue #240 — D35's Fix Cleaned the Wrong Disk

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Phase 20 was declared fully done, then reopened a second time the same
night this surfaced. See `docs/ROADMAP.md` Phase 20 and
`docs/DECISIONS.md` D43.*

## Why the exact same crash came back

A CD run failed with a signature that should have looked completely
familiar: `api`'s new pod crash-looped on OpenSearch's
`cluster_block_exception`, tripped by its flood-stage disk watermark —
the identical incident D35 (issue #215) had already diagnosed, fixed,
and documented earlier the same day. The instinctive read was "the D35
fix regressed" or "disk filled up again despite it." Neither was true.
D35's fix was still working exactly as designed — it just wasn't the
disk that filled up this time.

## Key concept: two disks, one fix

`cd.yml`'s "Prune stale Docker artifacts" step (D35) runs
`docker image prune` / `docker builder prune` — commands that operate
on the **host** Docker Desktop's own image and build-cache storage.
That's the disk D35 diagnosed and fixed, and the fix genuinely works
for that disk.

But `kind load docker-image` — the step every single deploy uses to get
a freshly built image into the cluster — doesn't touch the host's
Docker Desktop storage at all once the image is loaded. It copies the
image into the **kind node's own internal containerd store**: kind
runs an entire Kubernetes node inside a Docker container, and that
container has its own separate containerd, with its own separate image
and snapshot storage, entirely distinct from the host Docker Desktop
VM's cache that D35's commands reach. Every `kind load` retags the
node's `interview-insights-api:k8s`/`:web:k8s` forward to the new
build, but never removes the layers the previous build left behind
*there*. A single unusually heavy day — Phases 20 through 23, roughly
eight rebuild-and-`kind-load` cycles for live verification in one
session — was enough to push that separate disk to 91% full on its
own, entirely independent of whatever the host-level prune had already
cleaned.

Confirmed directly rather than assumed: `crictl images` inside the
node showed 48 images totaling 27GB, the overwhelming majority
untagged `import-2026-07-*` entries — exactly what `kind load`'s
retag-forward behavior produces, one entry per superseded build.

## Key concept: the D35 near-miss was still exactly right to worry about

D35's own postmortem had already flagged this general class of cleanup
as risky, documenting a near-miss where `crictl rmi --prune` almost
deleted the image backing a live `web` Deployment and
`ingress-nginx-controller` — because Kubernetes tracks a running
container by image *digest*, not by *tag*, and a tag that's since moved
forward to a newer build can leave an already-running pod depending on
a digest that's no longer reachable through any tag at all. `--prune`'s
"is this unreferenced" logic doesn't account for that gap.

That risk turned out to be live, not hypothetical, in tonight's
incident too: before removing anything, every running pod's actual
image digest was cross-referenced across the entire cluster — not just
this app's namespace — against the node's full image list. Both
currently-running `api`/`web` pods, *and* `ingress-nginx-controller`
(the exact image D35's near-miss almost deleted), were each depending
on a digest only reachable via one of the untagged `import-*` entries,
since the `:k8s` tag had since moved past all of them. A blind
`crictl rmi --prune` would very likely have repeated the near-miss for
real this time.

## Key concept: deletion and disk reclaim aren't the same event

One more thing only showed up by actually running this against the
live incident: `crictl rmi` reports `Deleted: ...` and appears to
succeed, but `df` doesn't reflect the freed space until `containerd`
itself is restarted — that restart appears to trigger the actual
garbage-collection pass over now-orphaned content blobs. Confirmed
directly: a single deletion, tried alone, measured zero change in disk
usage; a `containerd` restart alone, tried alone, also measured zero
change; only once both had happened together did `df` show the freed
space. Whichever one runs second is what actually triggers the
reclaim — the fix restarts `containerd` after every batch of removals,
not conditionally.

## System design approach

```bash
KEEP_DIGESTS=$(kubectl get pods -A -o jsonpath='{range .items[*]}{.status.containerStatuses[*].imageID}{"\n"}{end}' \
  | grep -oE 'sha256:[a-f0-9]+' | sort -u)

# ...compute, for each image in `crictl images -o json`:
#   - skip anything with a repoTag (never touch a named image)
#   - skip anything whose repoDigest intersects KEEP_DIGESTS
#   - the remainder is genuinely orphaned — safe to crictl rmi

docker exec "$NODE" systemctl restart containerd  # forces the actual reclaim
```

`infra/scripts/prune-kind-node-images.sh` implements exactly this,
wired into `cd.yml` as a second `if: always()` step alongside D35's
existing host-level prune — the same "clean up even on a failed
deploy" reasoning applies identically to both disks.

## Step-by-step: what actually got diagnosed, fixed, and verified

1. Confirmed the crash signature matched D35 exactly via
   `kubectl logs --previous` on the crash-looping pod.
2. Checked the *host* Docker Desktop disk first (the thing D35's fix
   already covers) — found it fine, ruling out a regression of that
   fix.
3. Checked the kind node's own filesystem directly
   (`docker exec interview-insights-control-plane df -h /`) — found it
   at 91%, a disk nothing in `cd.yml` had ever addressed.
4. Cross-referenced every running pod's image digest, cluster-wide,
   against the node's `crictl images` list before touching anything —
   confirmed exactly which images were genuinely orphaned versus still
   load-bearing.
5. Manually walked a careful, incremental version of the fix live
   against the real incident first (one image at a time, checking `df`
   after each step) before writing anything into a script — this is
   what surfaced the "deletion alone doesn't reclaim disk, restart
   alone doesn't either, both together does" finding; it wasn't
   something that could have been guessed correctly upfront.
6. Cleared OpenSearch's tripped blocks and confirmed the stuck rollout
   completed successfully once the node's disk was actually free.
7. Wrote `infra/scripts/prune-kind-node-images.sh` capturing exactly
   the sequence just verified live, then re-ran it against the
   now-clean cluster as its own test — it correctly found and removed
   only the single image freshly orphaned by that same rollout's own
   pod termination, confirming the keep-set logic holds up on a second,
   independent run, not just the one it was built to match.
8. Wired the script into `cd.yml`.

## What this enabled

A CD pipeline that's now self-cleaning on *both* disks a deploy
actually touches, not just the one the first incident happened to
surface. The broader lesson, worth carrying forward past this specific
fix: "the exact same crash came back" is a legitimate reason to check
whether the previous fix regressed, but it's just as often a sign that
the earlier diagnosis was correct but incomplete — a different resource
hitting the same downstream symptom. Confirming which one it was, by
checking the thing the existing fix already covers *first*, is what
kept this from becoming a wasted afternoon second-guessing a fix that
was never broken.
