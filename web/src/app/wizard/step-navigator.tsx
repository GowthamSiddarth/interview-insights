'use client';

import { useState } from 'react';
import { Round } from '@/lib/api';
import { ProcessDraft } from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { ROUND_TYPE_LABELS, ROUND_TYPES } from './round-type-labels';

const selectClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function stepButtonClass(active: boolean): string {
  return `w-full rounded-md px-2 py-1 text-left transition-colors ${
    active
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
  }`;
}

interface StepNavigatorProps {
  draft: ProcessDraft;
  // 'process', 'overall', and 'review' are fixed sentinel steps; anything
  // else is a round/recruiter step's clientId. Free jumping between any
  // of them — explicitly reversible, not a one-way flow (GitHub issue
  // #254; 'review' added in issue #255).
  activeStepId: string;
  onSelect: (stepId: string) => void;
  onAddRound: (roundType: Round['roundType']) => void;
  onAddRecruiter: (timing: 'start' | 'end') => void;
}

export function StepNavigator({
  draft,
  activeStepId,
  onSelect,
  onAddRound,
  onAddRecruiter,
}: StepNavigatorProps) {
  const [roundTypeToAdd, setRoundTypeToAdd] = useState<Round['roundType']>('coding');

  return (
    <div className="flex flex-col gap-3">
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
              Round {index + 1}: {step.round.title || <em>untitled</em>} —{' '}
              {ROUND_TYPE_LABELS[step.round.roundType]}
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
        <label className="flex flex-col text-xs">
          Add a round
          <select
            value={roundTypeToAdd}
            onChange={(e) => setRoundTypeToAdd(e.target.value as Round['roundType'])}
            className={selectClass}
          >
            {ROUND_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {ROUND_TYPE_LABELS[rt]}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={() => onAddRound(roundTypeToAdd)}>
          Add round
        </Button>
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
