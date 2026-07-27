// GitHub issue #406 (Phase 37) — shared manifest I/O between
// seed-demo-data.ts (writer) and seed-demo-data-undo.ts (reader/lister),
// so both scripts agree on the exact shape and location without
// duplicating the fs plumbing. A `dir` param (default SEED_RUNS_DIR) lets
// unit tests point at a temp directory instead of writing into the real
// gitignored .seed-runs/ folder.
import * as fs from 'fs';
import * as path from 'path';

export const SEED_RUNS_DIR = path.join(__dirname, '.seed-runs');

export interface SeedManifest {
  runId: string;
  createdAt: string;
  companyCount: number;
  // The two anchors everything else a seed run created hangs off of —
  // same "identify your own data by id" discipline as Summary.companyIds
  // (D62) applied to undo.
  companyIds: string[];
  candidateIds: string[];
}

function manifestPath(runId: string, dir: string): string {
  return path.join(dir, `${runId}.json`);
}

export function writeManifest(manifest: SeedManifest, dir: string = SEED_RUNS_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(manifest.runId, dir), JSON.stringify(manifest, null, 2));
}

export function readManifest(runId: string, dir: string = SEED_RUNS_DIR): SeedManifest {
  const raw = fs.readFileSync(manifestPath(runId, dir), 'utf-8');
  return JSON.parse(raw) as SeedManifest;
}

// Sorted oldest-first so --list reads as a chronological run history.
export function listManifests(dir: string = SEED_RUNS_DIR): SeedManifest[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as SeedManifest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Called after a successful undo — a manifest for an already-undone run
// has nothing left to roll back, so --list shouldn't keep offering it.
export function deleteManifest(runId: string, dir: string = SEED_RUNS_DIR): void {
  const target = manifestPath(runId, dir);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
