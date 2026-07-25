'use client';

import { DraftRecruiterInteraction, DraftRecruiterRating, DraftRecruiterStep } from '@/lib/draft-store';
import { Button } from '@/components/Button';

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

const RATING_FIELDS = ['reachability', 'responsiveness', 'guidelinesShared'] as const;

// GitHub issue #286 (Phase 28) — one-sentence definitions matching the
// Phase 24 issue #249 field-redesign, shown as a tooltip on each trait so
// a candidate knows what's actually being asked, not just a camelCase
// label.
const RATING_FIELD_TOOLTIPS: Record<(typeof RATING_FIELDS)[number], string> = {
  reachability: 'How easy the recruiter was to reach or get a response from.',
  responsiveness: 'How quickly and reliably they followed up or kept to promised timelines.',
  guidelinesShared: 'How clearly they explained the process, format, and what to expect at each stage.',
};
const REJECTION_AUTHENTICITY_TOOLTIP =
  'How genuine or personalized a rejection message felt, if this touchpoint was about a rejection.';

interface RecruiterStepFormProps {
  step: DraftRecruiterStep;
  onChange: (interaction: DraftRecruiterInteraction) => void;
  onRemove: () => void;
}

// GitHub issue #254 (Phase 26) — a recruiter touchpoint step. `timing`
// (start/end) is client-only, never sent to the backend (issue #253/D50)
// — it only decides where this step sorts on the chronological review
// screen (issue #255). It's chosen once, at add-time, via the step
// navigator's two distinct "+ Recruiter (pre-interview/post-interview)"
// buttons — GitHub issue #285 made it read-only here rather than an
// in-place editable select, since a candidate would otherwise have two
// different ways to set the same thing.
export function RecruiterStepForm({ step, onChange, onRemove }: RecruiterStepFormProps) {
  const { interaction, timing } = step;

  function update(patch: Partial<DraftRecruiterInteraction>) {
    onChange({ ...interaction, ...patch });
  }

  function toggleRating(hasRating: boolean) {
    update({
      rating: hasRating
        ? { reachability: 3, responsiveness: 3, guidelinesShared: 3 }
        : undefined,
    });
  }

  function updateRating(patch: Partial<DraftRecruiterRating>) {
    if (!interaction.rating) return;
    update({ rating: { ...interaction.rating, ...patch } });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Recruiter touchpoint</h3>

      <p className="text-sm">
        When was this? <span className="font-medium">{timing === 'start' ? 'Before my interview' : 'After my interview'}</span>
      </p>

      <label className="flex flex-col text-sm">
        Recruiter name or email
        <input
          value={interaction.recruiterIdentifier}
          onChange={(e) => update({ recruiterIdentifier: e.target.value })}
          className={inputClass}
        />
        <span className="text-xs text-gray-500">
          Used only to tell recruiters apart — never shown publicly.
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!interaction.rating}
          onChange={(e) => toggleRating(e.target.checked)}
        />
        I have a rating for this touchpoint
      </label>

      {interaction.rating && (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATING_FIELDS.map((field) => (
              <label
                key={field}
                className="flex flex-col text-sm capitalize"
                title={RATING_FIELD_TOOLTIPS[field]}
              >
                <span className="cursor-help underline decoration-dotted">
                  {field.replace(/([A-Z])/g, ' $1')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={interaction.rating![field]}
                  onChange={(e) => updateRating({ [field]: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col text-sm" title={REJECTION_AUTHENTICITY_TOOLTIP}>
            <span className="cursor-help underline decoration-dotted">
              Rejection message authenticity (optional — only if this
              touchpoint was about your rejection)
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={interaction.rating.rejectionMessageAuthenticity ?? ''}
              onChange={(e) =>
                updateRating({
                  rejectionMessageAuthenticity: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col text-sm">
            Anything else about the recruiter experience? (optional)
            <textarea
              rows={2}
              value={interaction.rating.freeText ?? ''}
              onChange={(e) => updateRating({ freeText: e.target.value || undefined })}
              className={inputClass}
            />
          </label>
        </div>
      )}

      <Button type="button" variant="danger" onClick={onRemove} className="self-start">
        Remove this touchpoint
      </Button>
    </div>
  );
}
