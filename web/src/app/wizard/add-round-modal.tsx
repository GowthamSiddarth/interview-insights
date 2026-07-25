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
  // GitHub issue #319 (Phase 28) — closes the modal only, no navigation.
  // The sidebar's separate "Add a round" control is gone (this modal is
  // now the only way to add one), so the previous "No, continue"
  // behavior of advancing to whatever Next would have done normally was
  // removed too — a candidate who cancels stays exactly where they are
  // and uses the free-jump step navigator if they want to go elsewhere.
  onCancel: () => void;
}

const NO_ROUND_TYPE_SELECTED = '';

// GitHub issue #306 (Phase 28) — shown when clicking "Next" would leave
// round-adding territory for the first time (from Process Details with no
// round yet, or from the last existing round). GitHub issue #319 made
// this the *only* way to add a round (the sidebar's redundant direct
// control was removed) and added the "must actually pick a type" gate
// below — the free-jump step navigator is unaffected either way.
export function AddRoundModal({ onAddRound, onFinishAndReview, onCancel }: AddRoundModalProps) {
  const [roundTypeToAdd, setRoundTypeToAdd] = useState<Round['roundType'] | ''>(
    NO_ROUND_TYPE_SELECTED,
  );

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
            onChange={(e) => setRoundTypeToAdd(e.target.value as Round['roundType'] | '')}
            className={selectClass}
          >
            <option value={NO_ROUND_TYPE_SELECTED}>None</option>
            {ROUND_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {ROUND_TYPE_LABELS[rt]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => onAddRound(roundTypeToAdd as Round['roundType'])}
            disabled={roundTypeToAdd === NO_ROUND_TYPE_SELECTED}
          >
            Add new round
          </Button>
          <Button type="button" variant="neutral" onClick={onFinishAndReview}>
            Finish draft &amp; go to review
          </Button>
          <Button type="button" variant="neutral" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
