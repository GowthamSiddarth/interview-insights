-- CreateTable
CREATE TABLE "round_type_field_options" (
    "id" UUID NOT NULL,
    "round_type" "RoundType" NOT NULL,
    "field_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "round_type_field_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "round_type_field_options_round_type_field_key_is_active_idx" ON "round_type_field_options"("round_type", "field_key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "round_type_field_options_round_type_field_key_value_key" ON "round_type_field_options"("round_type", "field_key", "value");

-- Seed illustrative default option values for every controlled field in the
-- round-type registry (api/src/round-type-registry). Fully admin-editable
-- later via Phase 27 — these are reasonable starting defaults, not final.
-- `other` has no controlled field (its only field, `notes`, is free text)
-- so it seeds nothing here, by design.
INSERT INTO "round_type_field_options" ("id", "round_type", "field_key", "value", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'DFS', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'BFS', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Dijkstra', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Dynamic Programming', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Binary Search', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Two Pointers', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Sliding Window', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Backtracking', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Greedy', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemAlgorithms', 'Topological Sort', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Array', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'String', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Hash Map', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Linked List', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Stack', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Queue', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Tree', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Graph', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Heap', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coding', 'problemDataStructures', 'Trie', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Load Balancing', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Caching', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Database Sharding', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Replication', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Message Queues', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'CAP Theorem', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Rate Limiting', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'CDN', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Consistent Hashing', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'system_design', 'keyConcepts', 'Microservices', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'frameworkUsed', 'STAR', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'frameworkUsed', 'SOAR', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'frameworkUsed', 'CAR', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Conflict Resolution', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Ownership', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Teamwork', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Failure & Learning', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Leadership', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Communication', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'behavioral', 'focusAreas', 'Prioritization', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Customer Obsession', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Ownership', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Bias for Action', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Deliver Results', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Earn Trust', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Think Big', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Dive Deep', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'leadership', 'principlesAsked', 'Frugality', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'case_study', 'frameworksUsed', 'SWOT', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'case_study', 'frameworksUsed', 'Porter''s Five Forces', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'case_study', 'frameworksUsed', '4Ps', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'case_study', 'frameworksUsed', 'Unit Economics', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'case_study', 'frameworksUsed', 'Market Sizing (Fermi)', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'assessmentFormat', 'Online Judge', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'assessmentFormat', 'Multiple Choice', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'assessmentFormat', 'Live Pairing', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'assessmentFormat', 'Whiteboard', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'skillsAssessed', 'Problem Solving', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'skillsAssessed', 'Code Quality', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'skillsAssessed', 'Communication', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'assessment', 'skillsAssessed', 'System Thinking', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'projectType', 'Feature Implementation', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'projectType', 'Bug Fix', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'projectType', 'Small App', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'projectType', 'API Design', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'JavaScript', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'TypeScript', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'Python', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'Java', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'Go', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'SQL', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'React', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'take_home', 'technologiesUsed', 'Node.js', 7, CURRENT_TIMESTAMP);
