-- GitHub issue #442 (Phase 39, D71) — new ModerationFlagReason value the
-- reconciliation sweep uses to escalate a pending row whose re-triage
-- attempt, past the 24h staleness window, still left moderationVerdict
-- null (feature error, refusal, unparseable response, etc.).
ALTER TYPE "ModerationFlagReason" ADD VALUE 'ai_triage_stalled';
