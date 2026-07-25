'use client';

import { RoundTypeFieldDef } from '@/lib/api';

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function labelFor(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// Renders a round's type_metadata fields generically, driven entirely by
// the round-type registry (GET /round-types/field-options, issue #248) —
// no per-round-type conditional here, so a 9th round type or a new field
// on an existing one needs zero changes to this component.
export function TypeMetadataFields({
  fields,
  value,
  onChange,
}: {
  fields: RoundTypeFieldDef[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        if (field.kind === 'text') {
          return (
            <label key={field.key} className="flex flex-col text-sm">
              {labelFor(field.key)}
              <textarea
                rows={2}
                value={(value[field.key] as string | undefined) ?? ''}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                className={inputClass}
              />
            </label>
          );
        }

        if (field.kind === 'controlled-single') {
          return (
            <label key={field.key} className="flex flex-col text-sm">
              {labelFor(field.key)}
              <select
                value={(value[field.key] as string | undefined) ?? ''}
                onChange={(e) =>
                  onChange({ ...value, [field.key]: e.target.value || undefined })
                }
                className={inputClass}
              >
                <option value="">— none —</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        // controlled-multi
        const selected = (value[field.key] as string[] | undefined) ?? [];
        return (
          <fieldset key={field.key} className="flex flex-col gap-1 text-sm">
            <legend>{labelFor(field.key)}</legend>
            <div className="flex flex-wrap gap-3">
              {(field.options ?? []).map((opt) => (
                <label key={opt} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, opt]
                        : selected.filter((o) => o !== opt);
                      onChange({ ...value, [field.key]: next });
                    }}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
