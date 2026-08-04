// GitHub issue #486 (Phase 36, D80) — the configurable-hours window behind
// ModerationQueueEntry.slaDeadline (moderation.service.ts's enqueue()/
// reenqueue()). Same empty-string-means-unset convention as
// getAutoApprovalConfidenceThreshold()
// (services/review-analyzer/src/analysis/ai-moderation.env.ts) — this
// project's .env.example/docker-compose.yml use "" for every optional var
// that should fall back to its default rather than error.
export function getModerationSlaHours(): number {
  const raw = process.env.MODERATION_SLA_HOURS;
  if (raw === undefined || raw === '') return 48;

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`MODERATION_SLA_HOURS must be a positive number, got "${raw}".`);
  }
  return hours;
}
