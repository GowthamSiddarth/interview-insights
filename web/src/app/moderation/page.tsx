'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  ModerationFlagReason,
  ModerationQueueEntity,
  ModerationQueueEntry,
} from '@/lib/api';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';

const ENTITY_TYPE_LABEL: Record<ModerationQueueEntry['entityType'], string> = {
  round_rating: 'Round rating',
  recruiter_rating: 'Recruiter rating',
  overall_review: 'Overall review',
};

const FLAG_REASONS: ModerationFlagReason[] = [
  'manual_report',
  'spam_pattern',
  'rate_limit',
  'duplicate',
];

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// The per-type score fields, rendered generically — the entity payload only
// carries the fields that exist for its type, so undefined ones just don't
// appear.
const SCORE_FIELDS = [
  'difficulty',
  'fairness',
  'communicationFluency',
  'attentiveness',
  'biasSignal',
  'technicalDepth',
  'approachability',
  'responseTime',
  'timeliness',
  'communicationQuality',
  'overallExperience',
] as const;

function EntityDetails({ entry }: { entry: ModerationQueueEntry }) {
  const entity: ModerationQueueEntity | null = entry.entity;
  if (!entity) {
    return <p className="text-sm text-gray-500 italic">Entity details unavailable.</p>;
  }
  const scores = SCORE_FIELDS.filter((f) => typeof entity[f] === 'number');
  const text = entity.freeText ?? entity.reviewText;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        <strong>{entity.companyName}</strong> · {entity.roleTitle}
        {entity.roundTitle && (
          <>
            {' '}
            · {entity.roundTitle} ({entity.roundType})
          </>
        )}
        {/* Generated label only — a real recruiter name never reaches this
            page (CLAUDE.md hard constraint #1). */}
        {entity.recruiterLabel && <> · {entity.recruiterLabel}</>}
      </p>
      {scores.length > 0 && (
        <p className="text-gray-600 dark:text-gray-400">
          {scores.map((f) => `${f.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${entity[f]}`).join(' · ')}
        </p>
      )}
      {entity.wouldRecommend !== undefined && (
        <p className="text-gray-600 dark:text-gray-400">
          would recommend: {entity.wouldRecommend ? 'yes' : 'no'}
        </p>
      )}
      {text && <blockquote className="border-l-2 border-gray-300 pl-2 italic">{text}</blockquote>}
      {entry.flagReason && (
        <p className="text-amber-700 dark:text-amber-400">
          Auto-flagged: {entry.flagReason} (fraud checks) — review with extra care.
        </p>
      )}
    </div>
  );
}

export default function ModerationPage() {
  const router = useRouter();
  // 'checking' never renders the queue (or the login redirect race) — a
  // 401 here always means "go to /moderation/login", never "show an error
  // inline," unlike the entries/actions error state below.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [entries, setEntries] = useState<ModerationQueueEntry[] | null>(null);
  const [reviewedBy, setReviewedBy] = useState('');
  const [flagReasonById, setFlagReasonById] = useState<Record<string, ModerationFlagReason>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAdminSession()
      .then(() => setSessionChecked(true))
      .catch(() => router.push('/moderation/login'));
  }, [router]);

  useEffect(() => {
    if (!sessionChecked) return;
    api
      .listModerationQueue()
      .then(setEntries)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [sessionChecked]);

  async function logout(): Promise<void> {
    await api.adminLogout().catch(() => undefined);
    router.push('/moderation/login');
  }

  async function act(
    entry: ModerationQueueEntry,
    action: 'approve' | 'reject' | 'flag',
  ): Promise<void> {
    setError(null);
    const name = reviewedBy.trim() || undefined;
    try {
      if (action === 'approve') await api.approveModerationEntry(entry.id, name);
      else if (action === 'reject') await api.rejectModerationEntry(entry.id, name);
      else
        await api.flagModerationEntry(
          entry.id,
          flagReasonById[entry.id] ?? 'manual_report',
          name,
        );
      setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Session check hasn't resolved (or is redirecting to login) — render
  // nothing rather than a flash of the queue UI.
  if (!sessionChecked) return null;

  return (
    <PageContainer>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Moderation queue</h1>
          <p className="text-sm text-gray-500">
            Pending ratings and reviews across all entity types. Approving makes an
            item publicly visible; rejecting and flagging keep it hidden.
          </p>
        </div>
        <Button type="button" onClick={() => void logout()} className="bg-gray-600 hover:bg-gray-700">
          Log out
        </Button>
      </header>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <label className="flex flex-col text-sm sm:w-64">
        Your moderator name (optional)
        <input
          value={reviewedBy}
          onChange={(e) => setReviewedBy(e.target.value)}
          className="rounded border px-2 py-1 dark:bg-gray-900"
        />
      </label>

      {/* null = still loading — must never look identical to an empty queue
          (the Phase 9 issue #61 rule). */}
      {entries === null && <p className="text-sm text-gray-500">Loading…</p>}
      {entries?.length === 0 && <EmptyState message="Queue is clear — nothing pending." />}

      {entries?.map((entry) => (
        <section
          key={entry.id}
          className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{ENTITY_TYPE_LABEL[entry.entityType]}</h2>
            <span className="text-xs text-gray-500">
              submitted {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
          <EntityDetails entry={entry} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void act(entry, 'approve')}>
              Approve
            </Button>
            <Button
              type="button"
              onClick={() => void act(entry, 'reject')}
              className="bg-red-600 hover:bg-red-700"
            >
              Reject
            </Button>
            <Button
              type="button"
              onClick={() => void act(entry, 'flag')}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Flag
            </Button>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              flag reason
              <select
                aria-label={`Flag reason for ${entry.id}`}
                value={flagReasonById[entry.id] ?? 'manual_report'}
                onChange={(e) =>
                  setFlagReasonById((prev) => ({
                    ...prev,
                    [entry.id]: e.target.value as ModerationFlagReason,
                  }))
                }
                className="rounded border px-1 py-0.5 dark:bg-gray-900"
              >
                {FLAG_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      ))}
    </PageContainer>
  );
}
