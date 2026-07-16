// docs/DATA_MODEL.md "Aggregation layer" / docs/DECISIONS.md D4 — not tuned
// against real data yet, starting constant only.
export const DEFAULT_SHRINKAGE_K = 8;

// Hard floor for displaying any public score. Below this, the frontend
// shows "not enough reviews yet" instead — CLAUDE.md hard constraint #3.
const MIN_SAMPLE_SIZE = 3;

// displayed_score = (n / (n + k)) * companyAvg + (k / (n + k)) * globalAvg
//
// Pulls small samples toward the platform-wide average and lets them
// converge to the true company average as sampleSize grows — no
// discontinuity, and more resistance to a handful of fake reviews swinging
// the number, unlike a flat "hide below n=5" cutoff.
export function computeShrinkageScore(
  sampleSize: number,
  companyAvg: number,
  globalAvg: number,
  k: number = DEFAULT_SHRINKAGE_K,
): number | null {
  if (sampleSize < MIN_SAMPLE_SIZE) return null;
  return (sampleSize / (sampleSize + k)) * companyAvg + (k / (sampleSize + k)) * globalAvg;
}
