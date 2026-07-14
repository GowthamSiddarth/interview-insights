// Entry point for background workers.
//
// Nothing runs yet — this is a placeholder for two workstreams defined in
// docs/ROADMAP.md:
//
//   Phase 3 — Moderation queue worker
//     Consumes rating/review-write events off the Kafka/Redpanda bus
//     (docs/ARCHITECTURE.md) and processes `moderation_queue` rows: rule-based
//     fraud/spam checks first, human review queue after. Every rating/review
//     starts at status = 'pending' (docs/DECISIONS.md D3) — this worker is
//     what moves rows to 'approved'/'rejected'/'flagged'.
//
//   Phase 4 — Aggregation worker
//     Recomputes the materialized views described in docs/DATA_MODEL.md
//     ("Aggregation layer") off the same event stream, so rating writes stay
//     fast and don't block on rollup recomputation.
//
// Each workstream should become its own entry/module here once built —
// don't merge unrelated consumers into one process.

export {};
