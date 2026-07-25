import { Round } from '@/lib/api';

// Human labels for the 9 round types — the registry (GET /round-types/
// field-options, Phase 24 issue #248) doesn't provide display labels, only
// field schemas, so this is the one place the frontend still names them.
// Object key order is deliberate (GitHub issue #319, Phase 28) — it drives
// ROUND_TYPES' iteration order below, laid out to match a typical
// interview loop's actual sequence rather than an arbitrary one:
// screening/assessment steps first, technical/behavioral rounds next,
// "other" last as the catch-all.
export const ROUND_TYPE_LABELS: Record<Round['roundType'], string> = {
  tech_screening: 'Tech Screening',
  assessment: 'Assessment',
  take_home: 'Take-home',
  coding: 'Coding',
  system_design: 'System design',
  case_study: 'Case study',
  behavioral: 'Behavioral',
  leadership: 'Leadership',
  other: 'Other',
};

export const ROUND_TYPES = Object.keys(ROUND_TYPE_LABELS) as Round['roundType'][];
