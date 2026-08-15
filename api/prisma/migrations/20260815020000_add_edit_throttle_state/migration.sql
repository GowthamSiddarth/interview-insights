-- GitHub issue #693 (Phase 49, D104) — Postgres-backed replacement for
-- EditThrottleService's old in-memory throttle, so state is shared
-- across api replicas instead of one independent bucket per instance.
CREATE TABLE "edit_throttle_state" (
    "candidate_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "edit_throttle_state_pkey" PRIMARY KEY ("candidate_id")
);

ALTER TABLE "edit_throttle_state"
    ADD CONSTRAINT "edit_throttle_state_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
