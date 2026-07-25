-- Seed illustrative default option values for "tech_screening"'s two
-- controlled fields (GitHub issue #284, Phase 28), same pattern as every
-- other structured round type (see 20260725070048_add_round_type_field_options).
-- Kept as its own migration, applied after the previous one that adds the
-- `tech_screening` enum value itself — Postgres doesn't allow a newly added
-- enum value to be used until the transaction that added it has committed.
INSERT INTO "round_type_field_options" ("id", "round_type", "field_key", "value", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'tech_screening', 'screeningFormat', 'Phone Call', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'screeningFormat', 'Video Call', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'screeningFormat', 'In Person', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'topicsCovered', 'Resume Walkthrough', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'topicsCovered', 'Basic Technical Q&A', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'topicsCovered', 'Culture Fit', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tech_screening', 'topicsCovered', 'Logistics & Availability', 3, CURRENT_TIMESTAMP);
