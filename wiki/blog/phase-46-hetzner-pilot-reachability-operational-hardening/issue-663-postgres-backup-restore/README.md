# Phase 46, Issue #663 — Postgres Backup Strategy, With a Proven Restore Path

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track B.*

## The gap this closed

`dev`/`staging`/`prod`'s Postgres data has never needed a backup
strategy — it's all disposable local `kind`-cluster data, wiped and
regenerated freely. The pilot's data is meant to be real. This issue
built the backup mechanism and, eventually, proved the restore half
actually works — not just that dumps get written somewhere.

## Backup: nightly, self-restoring, rotated

```bash
kubectl exec "$POD" -- pg_dump -U postgres --clean --if-exists "$DB" | gzip > "$FILE"
ls -1t "$BACKUP_DIR"/"${DB}"-*.sql.gz | tail -n "+$((KEEP + 1))" | xargs -r rm --
```

No credential needed for `pg_dump` — it runs inside the Postgres
container over the local unix socket, which the stock
`postgres:16-alpine` image trusts by default for local connections, the
same reason the StatefulSet's own `pg_isready` liveness/readiness
probes need none either. `--clean --if-exists` makes every dump
self-restoring against a database that already has the schema loaded,
rather than requiring a pre-emptied target. A cron entry (`03:00`
nightly) keeps the newest 7 dumps.

## A deliberately incomplete first PR, and why

The scripts and cron landed in a PR whose body explicitly avoided
claiming the restore path worked: at the time, the pilot had no
Postgres running at all (#648 hadn't deployed the overlay yet), so
there was nothing real to restore *from*. Rather than fake a green
checkmark, that PR's test plan left the restore-proof unchecked and
said so.

## A real accidental auto-close, caught days later

That same PR's own explanatory sentence — *"`663-verify-restore-path.sh`
covers this once #648 lands; that run is what actually **closes
#663**, not this PR"* — contained the literal text "closes #663"
despite the sentence's whole point being the opposite. GitHub's
closing-keyword parser is a plain regex match, not language-aware: it
closed the issue two seconds after that PR merged, silently, with no
comment. Not noticed until days later, when the issue's own `closedAt`
timestamp didn't line up with when the actual completing work
happened. Reopened once caught, and the gotcha itself got documented in
`wiki/github-project-setup.md` so it doesn't recur — a real process
lesson, not just a one-off annoyance.

## The real proof, once Postgres actually existed

```bash
kubectl exec "$POD" -- psql -c "INSERT INTO _restore_proof VALUES ('$MARKER');"
sudo /usr/local/bin/pilot-pg-backup.sh
kubectl exec "$POD" -- psql -c "DELETE FROM _restore_proof WHERE marker = '$MARKER';"
sudo /usr/local/bin/pilot-pg-restore.sh "$DUMP"
kubectl exec "$POD" -- psql -c "SELECT count(*) FROM _restore_proof WHERE marker = '$MARKER';"
```

```
PROVEN: backup -> delete -> restore round-trip recovered the data.
```

A marker row, inserted into the real pilot database, backed up,
deleted (simulating real data loss), restored from that exact backup,
and confirmed present again — a genuine round-trip against live data,
not a synthetic test fixture.

## Verification

The round-trip above, plus the nightly cron confirmed installed and
armed via `/etc/cron.d/pilot-pg-backup`. Closed for real only once this
live proof actually ran — twice, in fact, once accidentally too early,
corrected once the real evidence existed.
