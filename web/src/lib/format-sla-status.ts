// GitHub issue #490 (Phase 36, D80) — a moderator-facing time-remaining/
// overdue indicator for ModerationQueueEntry.slaDeadline. Pure function
// (takes `now` explicitly) so it's testable without faking the system
// clock — the moderation page passes `new Date()` at render time.
export interface SlaStatus {
  label: string;
  overdue: boolean;
}

function humanizeDurationMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function formatSlaStatus(slaDeadline: string, now: Date = new Date()): SlaStatus {
  const diffMs = new Date(slaDeadline).getTime() - now.getTime();
  if (diffMs <= 0) {
    return { label: `Overdue by ${humanizeDurationMs(-diffMs)}`, overdue: true };
  }
  return { label: `Due in ${humanizeDurationMs(diffMs)}`, overdue: false };
}
