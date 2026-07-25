'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, Round, RoundTypeFieldOptionRow, RoundTypeFieldOptions } from '@/lib/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import { ROUND_TYPES, ROUND_TYPE_LABELS } from '../../wizard/round-type-labels';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// A 401 anywhere on this page always means the session expired mid-use —
// same shape as web/src/app/moderation/page.tsx's isSessionExpired().
function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

interface FieldSectionProps {
  roundType: Round['roundType'];
  fieldKey: string;
  rows: RoundTypeFieldOptionRow[];
  onChanged: () => void;
  setError: (msg: string | null) => void;
  onSessionExpired: () => void;
}

function FieldSection({ roundType, fieldKey, rows, onChanged, setError, onSessionExpired }: FieldSectionProps) {
  const [newValue, setNewValue] = useState('');
  const [edits, setEdits] = useState<Record<string, { value: string; sortOrder: string }>>({});

  function editState(row: RoundTypeFieldOptionRow) {
    return edits[row.id] ?? { value: row.value, sortOrder: String(row.sortOrder) };
  }

  async function handleAdd() {
    if (!newValue.trim()) return;
    setError(null);
    try {
      await api.createRoundTypeFieldOption(roundType, { fieldKey, value: newValue.trim() });
      setNewValue('');
      onChanged();
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  async function handleSave(row: RoundTypeFieldOptionRow) {
    const state = editState(row);
    setError(null);
    try {
      await api.updateRoundTypeFieldOption(row.id, {
        value: state.value,
        sortOrder: Number(state.sortOrder),
      });
      onChanged();
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  async function handleToggleActive(row: RoundTypeFieldOptionRow) {
    setError(null);
    try {
      await api.updateRoundTypeFieldOption(row.id, { isActive: !row.isActive });
      onChanged();
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  return (
    <Card as="section" className="flex flex-col gap-3">
      <h3 className="font-medium">{fieldKey}</h3>

      {rows.length === 0 && <EmptyState message="No values yet." />}

      {rows.map((row) => {
        const state = editState(row);
        return (
          <div
            key={row.id}
            className={`flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm ${
              row.isActive
                ? 'border-gray-100 dark:border-gray-800'
                : 'border-gray-100 opacity-60 dark:border-gray-800'
            }`}
          >
            <input
              value={state.value}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, [row.id]: { ...state, value: e.target.value } }))
              }
              className={inputClass}
              aria-label={`Value for ${row.id}`}
            />
            <label className="flex items-center gap-1 text-xs text-gray-500">
              sort
              <input
                type="number"
                value={state.sortOrder}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [row.id]: { ...state, sortOrder: e.target.value } }))
                }
                className={`${inputClass} w-16`}
                aria-label={`Sort order for ${row.id}`}
              />
            </label>
            <Button type="button" onClick={() => void handleSave(row)}>
              Save
            </Button>
            <Button
              type="button"
              variant={row.isActive ? 'danger' : 'neutral'}
              onClick={() => void handleToggleActive(row)}
            >
              {row.isActive ? 'Retire' : 'Reactivate'}
            </Button>
            {!row.isActive && <span className="text-xs text-gray-500">retired</span>}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="New value"
          className={inputClass}
          aria-label={`New value for ${fieldKey}`}
        />
        <Button type="button" onClick={() => void handleAdd()} disabled={!newValue.trim()}>
          Add value
        </Button>
      </div>
    </Card>
  );
}

export default function RoundTypeOptionsPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [schema, setSchema] = useState<RoundTypeFieldOptions | null>(null);
  const [roundType, setRoundType] = useState<Round['roundType'] | ''>('');
  const [rows, setRows] = useState<RoundTypeFieldOptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAdminSession()
      .then(() => setSessionChecked(true))
      .catch(() => router.push('/moderation/login'));
  }, [router]);

  useEffect(() => {
    if (!sessionChecked) return;
    api.getRoundTypeFieldOptions().then(setSchema).catch((err: unknown) => setError(errorMessage(err)));
  }, [sessionChecked]);

  function loadRows(rt: Round['roundType']) {
    setRows(null);
    api
      .listRoundTypeFieldOptionsAdmin(rt)
      .then(setRows)
      .catch((err: unknown) => {
        if (isSessionExpired(err)) router.push('/moderation/login');
        else setError(errorMessage(err));
      });
  }

  function handleSelectRoundType(rt: Round['roundType'] | '') {
    setRoundType(rt);
    setError(null);
    if (rt) loadRows(rt);
    else setRows(null);
  }

  if (!sessionChecked) return null;

  const controlledFields =
    roundType && schema ? schema[roundType].fields.filter((f) => f.kind !== 'text') : [];

  return (
    <PageContainer size="wide">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Round-type field options</h1>
          <p className="text-sm text-gray-500">
            Manage the controlled-vocabulary values behind each round type&apos;s
            structured fields. Retiring a value hides it from new submissions
            without invalidating anything that already used it.
          </p>
        </div>
        <Link href="/moderation" className="text-sm text-indigo-600 underline dark:text-indigo-400">
          Back to moderation queue
        </Link>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <label className="flex flex-col text-sm sm:w-64">
        Round type
        <select
          value={roundType}
          onChange={(e) => handleSelectRoundType(e.target.value as Round['roundType'] | '')}
          className={inputClass}
        >
          <option value="">Select a round type…</option>
          {ROUND_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {ROUND_TYPE_LABELS[rt]}
            </option>
          ))}
        </select>
      </label>

      {!roundType && (
        <EmptyState message="Pick a round type above to manage its field options." />
      )}

      {roundType && schema === null && <p className="text-sm text-gray-500">Loading…</p>}

      {roundType && schema && controlledFields.length === 0 && (
        <EmptyState message={`${ROUND_TYPE_LABELS[roundType]} has no controlled-vocabulary fields — only free text.`} />
      )}

      {roundType && schema && rows === null && controlledFields.length > 0 && (
        <p className="text-sm text-gray-500">Loading…</p>
      )}

      {roundType &&
        schema &&
        rows !== null &&
        controlledFields.map((field) => (
          <FieldSection
            key={field.key}
            roundType={roundType}
            fieldKey={field.key}
            rows={rows.filter((r) => r.fieldKey === field.key)}
            onChanged={() => loadRows(roundType)}
            setError={setError}
            onSessionExpired={() => router.push('/moderation/login')}
          />
        ))}
    </PageContainer>
  );
}
