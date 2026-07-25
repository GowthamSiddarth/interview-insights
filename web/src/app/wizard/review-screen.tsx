'use client';

import { DraftValidationIssue, ProcessDraft } from '@/lib/draft-store';
import { GatedSection } from '@/components/GatedSection';
import { Button } from '@/components/Button';
import { formatRoundLabel } from '@/lib/format-round-label';
import { ROUND_TYPE_LABELS } from './round-type-labels';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';
const rowClass =
  'flex items-center justify-between gap-2 rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700';
const rowWithIssueClass =
  'flex items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm dark:border-amber-600 dark:bg-amber-950';

interface ReviewScreenProps {
  draft: ProcessDraft;
  loggedIn: boolean | null;
  submitting: boolean;
  // Client-side pre-submit validation (GitHub issue #281) — computed live
  // from the draft on every render, never stale state. Submit stays
  // disabled while any issue exists, so an invalid draft never reaches the
  // bulk endpoint at all.
  validationIssues: DraftValidationIssue[];
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
export function ReviewScreen({
  draft,
  loggedIn,
  submitting,
  validationIssues,
  onEditStep,
  onSubmit,
}: ReviewScreenProps) {
  const startSteps = draft.recruiterInteractions.filter((s) => s.timing === 'start');
  const endSteps = draft.recruiterInteractions.filter((s) => s.timing === 'end');
  const sortedRounds = [...draft.rounds].sort(
    (a, b) => a.round.sequenceNumber - b.round.sequenceNumber,
  );
  const isEmpty =
    sortedRounds.length === 0 &&
    draft.recruiterInteractions.length === 0 &&
    !draft.overallReview;

  function issueFor(stepId: string): DraftValidationIssue | undefined {
    return validationIssues.find((issue) => issue.stepId === stepId);
  }

  function rowFor(stepId: string): string {
    return issueFor(stepId) ? rowWithIssueClass : rowClass;
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-medium">Review your submission</h3>

      {isEmpty && (
        <p className="text-sm text-gray-500 italic">
          Nothing to review yet — add a round or recruiter touchpoint first.
        </p>
      )}

      {validationIssues.length > 0 && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Fix these before you can submit:</p>
          <ul className="mt-1 list-inside list-disc">
            {validationIssues.map((issue, i) => (
              <li key={i}>
                {issue.message}{' '}
                <button
                  type="button"
                  onClick={() => onEditStep(issue.stepId)}
                  className={linkClass}
                >
                  Fix
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {startSteps.map((step) => (
          <li key={step.clientId} className={rowFor(step.clientId)}>
            <span>
              Recruiter (pre-interview): {step.interaction.recruiterIdentifier || 'untitled'}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {sortedRounds.map((step, index) => (
          <li key={step.clientId} className={rowFor(step.clientId)}>
            <span>
              Round {index + 1}:{' '}
              {formatRoundLabel(ROUND_TYPE_LABELS[step.round.roundType], step.round.title)}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {endSteps.map((step) => (
          <li key={step.clientId} className={rowFor(step.clientId)}>
            <span>
              Recruiter (post-interview): {step.interaction.recruiterIdentifier || 'untitled'}
            </span>
            <button type="button" onClick={() => onEditStep(step.clientId)} className={linkClass}>
              Edit
            </button>
          </li>
        ))}

        {draft.overallReview && (
          <li className={rowFor('overall')}>
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
        <Button
          type="button"
          onClick={onSubmit}
          disabled={submitting || isEmpty || validationIssues.length > 0}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </GatedSection>
    </div>
  );
}
