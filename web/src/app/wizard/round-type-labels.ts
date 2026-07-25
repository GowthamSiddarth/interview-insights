import { Round } from '@/lib/api';

// Human labels for the 8 round types — the registry (GET /round-types/
// field-options, Phase 24 issue #248) doesn't provide display labels, only
// field schemas, so this is the one place the frontend still names them.
export const ROUND_TYPE_LABELS: Record<Round['roundType'], string> = {
  coding: 'Coding',
  system_design: 'System design',
  behavioral: 'Behavioral',
  leadership: 'Leadership',
  case_study: 'Case study',
  assessment: 'Assessment',
  take_home: 'Take-home',
  other: 'Other',
};

export const ROUND_TYPES = Object.keys(ROUND_TYPE_LABELS) as Round['roundType'][];
