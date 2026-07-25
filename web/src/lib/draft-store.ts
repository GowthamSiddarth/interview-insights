import type { Company, InterviewProcess, Round } from './api';

// GitHub issue #253 (Phase 26) — client-side draft state. Nothing here
// touches the network; a draft is pure browser state (localStorage) until
// issue #255's bulk submit. The stored shape mirrors the bulk-submission
// endpoint's request DTOs directly (api/src/bulk-process-submission/dto/*)
// plus a thin layer of client-only fields (`clientId`, `timing`) that never
// leave the browser — there is no translation step at submit time, only a
// strip of those client-only fields (see issue #255).
//
// This is the first client-side persistence anywhere in `web/` — no prior
// localStorage/sessionStorage usage exists to follow or conflict with.

export interface DraftRoundRating {
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
  technicalDepth?: number;
  freeText?: string;
}

export interface DraftRound {
  sequenceNumber: number;
  // Optional (GitHub issue #287, Phase 28) — display sites fall back to
  // just the round type when absent.
  title?: string;
  roundType: Round['roundType'];
  description?: string;
  scheduledDurationMinutes?: number;
  typeMetadata?: Record<string, unknown>;
  // Optional — a round can exist in a draft with no rating yet, same as
  // the schema already allows server-side (GitHub issue #260).
  rating?: DraftRoundRating;
}

export interface DraftRoundStep {
  clientId: string;
  round: DraftRound;
}

export interface DraftRecruiterRating {
  reachability: number;
  responsiveness: number;
  guidelinesShared: number;
  rejectionMessageAuthenticity?: number;
  freeText?: string;
}

export interface DraftRecruiterInteraction {
  recruiterIdentifier: string;
  rating?: DraftRecruiterRating;
}

export interface DraftRecruiterStep {
  clientId: string;
  // Client-only — never sent to the backend. Realizes issue #254's
  // "Recruiter — Start" / "Recruiter — End" step kinds: every 'start' step
  // sorts before all rounds on the review screen (issue #255), every 'end'
  // step sorts after, without the candidate managing a numeric position.
  timing: 'start' | 'end';
  interaction: DraftRecruiterInteraction;
}

export interface DraftProcess {
  roleTitle: string;
  level?: string;
  department?: string;
  applicationDate?: string;
  outcome: InterviewProcess['outcome'];
}

export interface DraftOverallReview {
  overallExperience: number;
  wouldRecommend: boolean;
  reviewText?: string;
}

export interface ProcessDraft {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  process: DraftProcess;
  rounds: DraftRoundStep[];
  recruiterInteractions: DraftRecruiterStep[];
  overallReview?: DraftOverallReview;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'interview-insights:drafts:v1';

function readStore(): Record<string, ProcessDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ProcessDraft>) : {};
  } catch {
    // Corrupted/foreign data under this key — treat as no drafts rather
    // than throwing and breaking the whole page.
    return {};
  }
}

function writeStore(store: Record<string, ProcessDraft>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

// crypto.randomUUID() requires a secure context — real in the test
// environment (jsdom's crypto shim doesn't implement it at all) and real
// in production too: this app's deployed environments are plain HTTP on a
// non-localhost origin (docs/DECISIONS.md D27, no TLS yet), which is not
// a secure context either. Feature-detected fallback, not just a test
// shim — a client-only draft/step id has no security requirement anyway.
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function listDrafts(): ProcessDraft[] {
  return Object.values(readStore()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function getDraft(id: string): ProcessDraft | undefined {
  return readStore()[id];
}

export function createDraft(company: Pick<Company, 'id' | 'name' | 'slug'>): ProcessDraft {
  const now = new Date().toISOString();
  const draft: ProcessDraft = {
    id: generateId(),
    companyId: company.id,
    companyName: company.name,
    companySlug: company.slug,
    process: { roleTitle: '', outcome: 'in_progress' },
    rounds: [],
    recruiterInteractions: [],
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store[draft.id] = draft;
  writeStore(store);
  return draft;
}

export function saveDraft(draft: ProcessDraft): ProcessDraft {
  const updated: ProcessDraft = { ...draft, updatedAt: new Date().toISOString() };
  const store = readStore();
  store[updated.id] = updated;
  writeStore(store);
  return updated;
}

export function deleteDraft(id: string): void {
  const store = readStore();
  delete store[id];
  writeStore(store);
}

// Pure helpers for issue #254's step navigator (kept here since the data
// layer is this issue's full scope) — each takes and returns a
// ProcessDraft with no I/O, so a caller just does
// `saveDraft(addRoundStep(draft, ...))`.
export function addRoundStep(draft: ProcessDraft, round: DraftRound): ProcessDraft {
  return { ...draft, rounds: [...draft.rounds, { clientId: generateId(), round }] };
}

export function updateRoundStep(
  draft: ProcessDraft,
  clientId: string,
  round: DraftRound,
): ProcessDraft {
  return {
    ...draft,
    rounds: draft.rounds.map((step) => (step.clientId === clientId ? { ...step, round } : step)),
  };
}

export function removeRoundStep(draft: ProcessDraft, clientId: string): ProcessDraft {
  return { ...draft, rounds: draft.rounds.filter((step) => step.clientId !== clientId) };
}

export function addRecruiterStep(
  draft: ProcessDraft,
  interaction: DraftRecruiterInteraction,
  timing: DraftRecruiterStep['timing'],
): ProcessDraft {
  return {
    ...draft,
    recruiterInteractions: [
      ...draft.recruiterInteractions,
      { clientId: generateId(), timing, interaction },
    ],
  };
}

export function updateRecruiterStep(
  draft: ProcessDraft,
  clientId: string,
  interaction: DraftRecruiterInteraction,
  timing?: DraftRecruiterStep['timing'],
): ProcessDraft {
  return {
    ...draft,
    recruiterInteractions: draft.recruiterInteractions.map((step) =>
      step.clientId === clientId
        ? { ...step, interaction, ...(timing ? { timing } : {}) }
        : step,
    ),
  };
}

export function removeRecruiterStep(draft: ProcessDraft, clientId: string): ProcessDraft {
  return {
    ...draft,
    recruiterInteractions: draft.recruiterInteractions.filter(
      (step) => step.clientId !== clientId,
    ),
  };
}

export function setOverallReview(
  draft: ProcessDraft,
  overallReview: DraftOverallReview | undefined,
): ProcessDraft {
  return { ...draft, overallReview };
}

export interface DraftValidationIssue {
  // 'process' | 'overall' | a round/recruiter step's clientId — matches
  // StepNavigator's own step-id vocabulary, so a caller can jump straight
  // to the offending step.
  stepId: string;
  message: string;
}

function isValidRating1to5(value: number | undefined): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 1 && value <= 5;
}

// Client-side pre-submit validation (GitHub issue #281, Phase 28) — mirrors
// the backend's own required-field rules closely enough to catch the
// common mistakes (an empty recruiter identifier, an out-of-range rating)
// before the bulk endpoint ever sees them, so a candidate never has to
// decode a raw class-validator message like
// "recruiterInteractions.0.recruiterIdentifier should not be empty".
export function validateDraft(draft: ProcessDraft): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];

  if (!draft.process.roleTitle.trim()) {
    issues.push({ stepId: 'process', message: 'Role title is required.' });
  }

  draft.rounds.forEach((step, index) => {
    // Title is optional (GitHub issue #287) — nothing to validate here.
    if (step.round.rating) {
      const { difficulty, fluency, clarity, focus } = step.round.rating;
      if (
        !isValidRating1to5(difficulty) ||
        !isValidRating1to5(fluency) ||
        !isValidRating1to5(clarity) ||
        !isValidRating1to5(focus)
      ) {
        issues.push({
          stepId: step.clientId,
          message: `Round ${index + 1}'s rating fields must all be between 1 and 5.`,
        });
      }
    }
  });

  draft.recruiterInteractions.forEach((step, index) => {
    if (!step.interaction.recruiterIdentifier.trim()) {
      issues.push({
        stepId: step.clientId,
        message: `Recruiter touchpoint ${index + 1} needs a name or email.`,
      });
    }
    if (step.interaction.rating) {
      const { reachability, responsiveness, guidelinesShared } = step.interaction.rating;
      if (
        !isValidRating1to5(reachability) ||
        !isValidRating1to5(responsiveness) ||
        !isValidRating1to5(guidelinesShared)
      ) {
        issues.push({
          stepId: step.clientId,
          message: `Recruiter touchpoint ${index + 1}'s rating fields must all be between 1 and 5.`,
        });
      }
    }
  });

  if (draft.overallReview && !isValidRating1to5(draft.overallReview.overallExperience)) {
    issues.push({ stepId: 'overall', message: 'Overall experience rating must be between 1 and 5.' });
  }

  return issues;
}
