-- GitHub issue #690 (Phase 49, D104) — new terminal ModerationStatus
-- value, set instead of 'rejected' when an admin rejects an
-- already-escalated entry (#689). Standalone ALTER TYPE ADD VALUE, same
-- pattern #442's ai_triage_stalled flag-reason addition already used.
ALTER TYPE "ModerationStatus" ADD VALUE 'permanently_rejected';
