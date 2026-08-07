#!/bin/bash
set -euo pipefail

# Safely prunes orphaned images from the kind node's own containerd store
# (GitHub issue TBD, D43) — a different location entirely from the host
# Podman cache cd.yml's "Prune stale Podman artifacts" step already
# cleans (D35; podman since GitHub issue #540/D90). `kind load
# image-archive` copies the built image into the node's own internal
# containerd content/snapshot store and
# retags forward, but never removes the layers the previous build left
# behind there — accumulating unboundedly on this project's persistent,
# on-demand self-hosted runner (issue #88). Real incident, 2026-07-24: the
# node's own filesystem hit 91% full after a single heavy day of rebuilds,
# tripping OpenSearch's flood-stage watermark exactly like D35's original
# incident, but from a location that fix never touched.
#
# Deliberately NOT a blind `crictl rmi --prune` — D35's own near-miss
# documented exactly why: kubelet/containerd track a running container by
# image digest, not tag, so a tag moving forward to a new build can leave
# a still-running pod depending on a digest no longer reachable by any
# tag — `--prune`'s "unreferenced" logic doesn't account for that. Instead:
# compute the exact set of image digests currently in use by any pod in
# any namespace (the real source of truth for "safe to delete"), and only
# remove node-side images that are (a) untagged — a plain `kind load`
# retagging artifact, never a base image or anything pulled by name — and
# (b) not in that keep set.

CLUSTER_NAME="${1:-interview-insights}"
NODE="${CLUSTER_NAME}-control-plane"
KEEP_DIGESTS_FILE="$(mktemp)"
NODE_IMAGES_FILE="$(mktemp)"
REMOVE_IDS_FILE="$(mktemp)"
trap 'rm -f "$KEEP_DIGESTS_FILE" "$NODE_IMAGES_FILE" "$REMOVE_IDS_FILE"' EXIT

kubectl get pods -A -o jsonpath='{range .items[*]}{.status.containerStatuses[*].imageID}{"\n"}{end}' \
  | grep -oE 'sha256:[a-f0-9]+' | sort -u > "$KEEP_DIGESTS_FILE"

# GitHub issue #540 (D90): `docker exec` -> `podman exec` -- the node
# container itself is now created by podman
# (`KIND_EXPERIMENTAL_PROVIDER=podman`, set by whatever created this
# cluster), same crictl-inside-the-node mechanics either way.
podman exec "$NODE" crictl images -o json > "$NODE_IMAGES_FILE"

python3 - "$KEEP_DIGESTS_FILE" "$NODE_IMAGES_FILE" > "$REMOVE_IDS_FILE" <<'PYEOF'
import json
import sys

keep_path, images_path = sys.argv[1], sys.argv[2]

with open(keep_path) as f:
    keep = {line.strip() for line in f if line.strip()}

with open(images_path) as f:
    data = json.load(f)

for img in data["images"]:
    if img.get("repoTags"):
        continue  # never touch a named/tagged image
    digests = {rd.split("@")[1] for rd in (img.get("repoDigests") or []) if "@" in rd}
    if not (digests & keep):
        print(img["id"])
PYEOF

if [ ! -s "$REMOVE_IDS_FILE" ]; then
  echo "No orphaned node-side images to prune."
  exit 0
fi

echo "Removing $(wc -l < "$REMOVE_IDS_FILE" | tr -d ' ') orphaned node-side image(s)..."
while read -r id; do
  podman exec "$NODE" crictl rmi "$id" || true
done < "$REMOVE_IDS_FILE"

# Deletions alone don't always trigger immediate disk reclaim (confirmed
# live during the 2026-07-24 incident) — restarting containerd forces the
# garbage collection pass. Already-running containers survive this; it
# restarts only the management daemon, not the containers themselves.
echo "Restarting containerd to reclaim disk..."
podman exec "$NODE" systemctl restart containerd
sleep 5
podman exec "$NODE" df -h /
