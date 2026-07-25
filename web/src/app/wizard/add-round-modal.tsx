'use client';

import { useState } from 'react';
import { Round } from '@/lib/api';
import { Button } from '@/components/Button';
import { ROUND_TYPE_LABELS, ROUND_TYPES } from './round-type-labels';

const selectClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

interface AddRoundModalProps {
  onAddRound: (roundType: Round['roundType']) => void;
  onFinishAndReview: () => void;
  // Performs whatever Next would have done before this modal intercepted
  // it — advancing to the next already-existing step (a recruiter
  // touchpoint, overall review) if there is one. Distinct from just
  // closing the modal: this one still moves forward.
  onContinue: () => void;
}

// GitHub issue #306 (Phase 28) — shown when clicking "Next" would leave
// round-adding territory for the first time (from Process Details with no
// round yet, or from the last existing round), since the sidebar's
// separate "Add a round" control was easy to miss entirely. A candidate
// can add another round, jump straight to the review screen, or just
// continue on to whatever's next in the existing sequence — the
// free-jump step navigator is unaffected either way.
export function AddRoundModal({ onAddRound, onFinishAndReview, onContinue }: AddRoundModalProps) {
  const [roundTypeToAdd, setRoundTypeToAdd] = useState<Round['roundType']>('coding');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add another round"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <h3 className="font-medium">Add another round?</h3>
        <label className="flex flex-col text-sm">
          Round type
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onAddRound(roundTypeToAdd)}>
            Add round
          </Button>
          <Button type="button" variant="neutral" onClick={onFinishAndReview}>
            Finish draft &amp; go to review
          </Button>
          <Button type="button" variant="neutral" onClick={onContinue}>
            No, continue
          </Button>
        </div>
      </div>
    </div>
  );
}
