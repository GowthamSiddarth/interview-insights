'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import { ProcessDraft } from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { formatRoundLabel } from '@/lib/format-round-label';
import { ROUND_TYPE_LABELS } from './round-type-labels';

function stepButtonClass(active: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
    active
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
  }`;
}

// A step's own rated/unrated icon (GitHub issue #621) — 'process' and
// 'review' are structural, not something with a "rating" to complete,
// so they render no icon at all rather than a misleading always-empty
// or always-filled one.
function RatedIcon({ rated }: { rated: boolean }) {
  return rated ? (
    <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
  ) : (
    <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
  );
}

interface StepNavigatorProps {
  draft: ProcessDraft;
  // 'process', 'overall', and 'review' are fixed sentinel steps; anything
  // else is a round/recruiter step's clientId. Free jumping between any
  // of them — explicitly reversible, not a one-way flow (GitHub issue
  // #254; 'review' added in issue #255).
  activeStepId: string;
  onSelect: (stepId: string) => void;
  onAddRecruiter: (timing: 'start' | 'end') => void;
}

export function StepNavigator({
  draft,
  activeStepId,
  onSelect,
  onAddRecruiter,
}: StepNavigatorProps) {
  // GitHub issue #621 — a completion count, not a step *position*
  // (Phase 26's free-jump sidebar already shows position via the
  // highlighted item): how many of the ratings this review actually
  // needs are done. 'process'/'review' aren't ratings, so they're not
  // counted either way.
  const ratedCount =
    draft.rounds.filter((s) => s.round.rating).length +
    draft.recruiterInteractions.filter((s) => s.interaction.rating).length +
    (draft.overallReview ? 1 : 0);
  const totalCount = draft.rounds.length + draft.recruiterInteractions.length + 1;
  const progressPct = totalCount === 0 ? 0 : (ratedCount / totalCount) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Progress</span>
          <span className="font-mono tabular-nums">
            {ratedCount} of {totalCount} rated
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-indigo-600 transition-[width] dark:bg-indigo-400"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        <li>
          <button
            type="button"
            onClick={() => onSelect('process')}
            className={stepButtonClass(activeStepId === 'process')}
          >
            Process details
          </button>
        </li>
        {draft.rounds.map((step, index) => (
          <li key={step.clientId}>
            <button
              type="button"
              onClick={() => onSelect(step.clientId)}
              className={stepButtonClass(activeStepId === step.clientId)}
            >
              <RatedIcon rated={Boolean(step.round.rating)} />
              Round {index + 1}:{' '}
              {formatRoundLabel(ROUND_TYPE_LABELS[step.round.roundType], step.round.title)}
            </button>
          </li>
        ))}
        {draft.recruiterInteractions.map((step) => (
          <li key={step.clientId}>
            <button
              type="button"
              onClick={() => onSelect(step.clientId)}
              className={stepButtonClass(activeStepId === step.clientId)}
            >
              <RatedIcon rated={Boolean(step.interaction.rating)} />
              Recruiter ({step.timing === 'start' ? 'pre-interview' : 'post-interview'}):{' '}
              {step.interaction.recruiterIdentifier || <em>untitled</em>}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => onSelect('overall')}
            className={stepButtonClass(activeStepId === 'overall')}
          >
            <RatedIcon rated={Boolean(draft.overallReview)} />
            Overall review
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => onSelect('review')}
            className={stepButtonClass(activeStepId === 'review')}
          >
            Review &amp; Submit
          </button>
        </li>
      </ul>

      <div className="flex flex-wrap items-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <Button type="button" variant="neutral" onClick={() => onAddRecruiter('start')}>
          + Recruiter (pre-interview)
        </Button>
        <Button type="button" variant="neutral" onClick={() => onAddRecruiter('end')}>
          + Recruiter (post-interview)
        </Button>
      </div>
    </div>
  );
}
