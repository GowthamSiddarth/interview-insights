import { RoundType } from '@prisma/client';

// Single source of truth mapping round type -> its type_metadata field
// schema. `controlled-*` fields' selectable values live in the
// round_type_field_options table (admin-managed starting Phase 27, see
// docs/DECISIONS.md D47) rather than being hardcoded here; `text` fields are
// free-form strings with no admin-managed vocabulary. `other` deliberately
// has no controlled field — it's the catch-all round type by definition.
export type FieldKind = 'controlled-single' | 'controlled-multi' | 'text';

export interface RoundTypeFieldDef {
  key: string;
  kind: FieldKind;
}

export const ROUND_TYPE_FIELD_SCHEMA: Record<RoundType, RoundTypeFieldDef[]> = {
  coding: [
    { key: 'problemAlgorithms', kind: 'controlled-multi' },
    { key: 'problemDataStructures', kind: 'controlled-multi' },
    { key: 'problemDescription', kind: 'text' },
  ],
  system_design: [
    { key: 'keyConcepts', kind: 'controlled-multi' },
    { key: 'highLevelConcept', kind: 'text' },
  ],
  behavioral: [
    { key: 'frameworkUsed', kind: 'controlled-single' },
    { key: 'focusAreas', kind: 'controlled-multi' },
  ],
  leadership: [{ key: 'principlesAsked', kind: 'controlled-multi' }],
  case_study: [
    { key: 'frameworksUsed', kind: 'controlled-multi' },
    { key: 'industryContext', kind: 'text' },
  ],
  assessment: [
    { key: 'assessmentFormat', kind: 'controlled-single' },
    { key: 'skillsAssessed', kind: 'controlled-multi' },
  ],
  take_home: [
    { key: 'projectType', kind: 'controlled-single' },
    { key: 'technologiesUsed', kind: 'controlled-multi' },
  ],
  other: [{ key: 'notes', kind: 'text' }],
};
