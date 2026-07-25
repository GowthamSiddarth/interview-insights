'use client';

import { RoundTypeFieldOptions } from '@/lib/api';
import { DraftRound, DraftRoundRating, DraftRoundStep } from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { ROUND_TYPE_LABELS } from './round-type-labels';
import { TypeMetadataFields } from './type-metadata-fields';

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

const RATING_FIELDS = ['difficulty', 'fluency', 'clarity', 'focus'] as const;

interface RoundStepFormProps {
  step: DraftRoundStep;
  fieldOptions: RoundTypeFieldOptions | null;
  onChange: (round: DraftRound) => void;
  onRemove: () => void;
}

// Registry-driven round-step editor (GitHub issue #254, Phase 26). A
// round can exist with no rating yet, mirroring the schema's own
// tolerance for that state (issue #260) — the checkbox below is the only
// thing that decides whether `rating` is present at all in the draft.
export function RoundStepForm({ step, fieldOptions, onChange, onRemove }: RoundStepFormProps) {
  const { round } = step;
  const fields = fieldOptions?.[round.roundType]?.fields ?? [];

  function update(patch: Partial<DraftRound>) {
    onChange({ ...round, ...patch });
  }

  function toggleRating(hasRating: boolean) {
    update({
      rating: hasRating
        ? { difficulty: 3, fluency: 3, clarity: 3, focus: 3 }
        : undefined,
    });
  }

  function updateRating(patch: Partial<DraftRoundRating>) {
    if (!round.rating) return;
    update({ rating: { ...round.rating, ...patch } });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">{ROUND_TYPE_LABELS[round.roundType]} round</h3>

      <label className="flex flex-col text-sm">
        Title (optional)
        <input
          value={round.title ?? ''}
          onChange={(e) => update({ title: e.target.value || undefined })}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col text-sm">
        Description (optional)
        <textarea
          rows={2}
          value={round.description ?? ''}
          onChange={(e) => update({ description: e.target.value || undefined })}
          className={inputClass}
        />
      </label>

      {fields.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-500">Round details</p>
          <TypeMetadataFields
            fields={fields}
            value={round.typeMetadata ?? {}}
            onChange={(next) => update({ typeMetadata: next })}
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!round.rating}
          onChange={(e) => toggleRating(e.target.checked)}
        />
        I have a rating for this round
      </label>

      {round.rating && (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATING_FIELDS.map((field) => (
              <label key={field} className="flex flex-col text-sm capitalize">
                {field}
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={round.rating![field]}
                  onChange={(e) => updateRating({ [field]: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col text-sm">
            Technical depth (optional)
            <input
              type="number"
              min={1}
              max={5}
              value={round.rating.technicalDepth ?? ''}
              onChange={(e) =>
                updateRating({
                  technicalDepth: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col text-sm">
            Anything else about this round? (optional)
            <textarea
              rows={2}
              value={round.rating.freeText ?? ''}
              onChange={(e) => updateRating({ freeText: e.target.value || undefined })}
              className={inputClass}
            />
          </label>
        </div>
      )}

      <Button type="button" variant="danger" onClick={onRemove} className="self-start">
        Remove this round
      </Button>
    </div>
  );
}
