'use client';

import { ProcessDraft } from '@/lib/draft-store';
import { GatedSection } from '@/components/GatedSection';
import { Button } from '@/components/Button';
import { ROUND_TYPE_LABELS } from './round-type-labels';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';
const rowClass =
  'flex items-center justify-between gap-2 rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700';

interface ReviewScreenProps {
  draft: ProcessDraft;
  loggedIn: boolean | null;
  submitting: boolean;
  onEditStep: (stepId: string) => void;
  onSubmit: () => void;
}

// GitHub issue #255 (Phase 26) — every filled step, chronologically
// ordered, with the actual bulk-submit call as the only thing that ever
// touches the backend. Rounds sort by their own sequenceNumber; recruiter
// steps use the client-only `timing` field (D50) to place 'start' steps
// before all rounds and 'end' steps after — a display-only merge, the
// submitted payload keeps rounds/recruiterInteractions as two separate
// arrays exactly as the bulk endpoint expects.
export function ReviewScreen({ draft, loggedIn, submitting, onEditStep, onSubmit }: ReviewScreenProps) {
  const startSteps = draft.recruiterInteractions.filter((s) => s.timing === 'start');
  const endSteps = draft.recruiterInteractions.filter((s) => s.timing === 'end');
  const sortedRounds = [...draft.rounds].sort(
    (a, b) => a.round.sequenceNumber - b.round.sequenceNumber,
  );
  const isEmpty =
    sortedRounds.length === 0 &&
    draft.recruiterInteractions.length === 0 &&
    !draft.overallReview;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-medium">Review your submission</h3>

      {isEmpty && (
        <p className="text-sm text-gray-500 italic">
          Nothing to review yet — add a round or recruiter touchpoint first.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {startSteps.map((step) => (
          <li key={step.clientId} className={rowClass}>
            <span>
              Recruiter (before rounds): {step.interaction.recruiterIdentifier || 'untitled'}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {sortedRounds.map((step, index) => (
          <li key={step.clientId} className={rowClass}>
            <span>
              Round {index + 1}: {step.round.title || 'untitled'} —{' '}
              {ROUND_TYPE_LABELS[step.round.roundType]}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {endSteps.map((step) => (
          <li key={step.clientId} className={rowClass}>
            <span>
              Recruiter (after rounds): {step.interaction.recruiterIdentifier || 'untitled'}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {draft.overallReview && (
          <li className={rowClass}>
            <span>Overall review provided</span>
            <button type="button" onClick={() => onEditStep('overall')} className={linkClass}>
              Edit
            </button>
          </li>
        )}
      </ol>

      <GatedSection
        loggedIn={loggedIn}
        prompt="Log in to submit — this is the only step in the whole draft that needs a session."
      >
        <Button type="button" onClick={onSubmit} disabled={submitting || isEmpty}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </GatedSection>
    </div>
  );
}
