'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  ApiError,
  ModerationFlagReason,
  ModerationQueueEntity,
  ModerationQueueEntry,
  ModerationQueueGroup,
} from '@/lib/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import { formatRoundLabel } from '@/lib/format-round-label';
import { ROUND_TYPE_LABELS } from '../wizard/round-type-labels';

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

// A 401 here always means the session expired mid-use (the initial-load
// gate already handled "never had one") — the caller should redirect back
// to login, not render it through the generic `error` state, which would
// just look like a confusing, unrelated failure.
function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

// The per-type score fields, rendered generically — the entity payload only
// carries the fields that exist for its type, so undefined ones just don't
// appear.
const SCORE_FIELDS = [
  'difficulty',
  'fluency',
  'clarity',
  'focus',
  'technicalDepth',
  'reachability',
  'responsiveness',
  'guidelinesShared',
  'rejectionMessageAuthenticity',
  'overallExperience',
] as const;

// GitHub issue #315: renders every data point the candidate actually
// submitted for a round — not just the highlighted score fields — so a
// moderator never has to guess at content this page doesn't surface.
function RoundContentDetails({ entity }: { entity: ModerationQueueEntity }) {
  const metadataEntries = entity.roundTypeMetadata ? Object.entries(entity.roundTypeMetadata) : [];
  if (!entity.roundDescription && metadataEntries.length === 0 && !entity.roundScheduledDurationMinutes) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {entity.roundDescription && <p>{entity.roundDescription}</p>}
      {entity.roundScheduledDurationMinutes && <p>scheduled duration: {entity.roundScheduledDurationMinutes} min</p>}
      {metadataEntries.map(([key, value]) => (
        <p key={key}>
          {key.replace(/([A-Z])/g, ' $1').toLowerCase()}: {Array.isArray(value) ? value.join(', ') : String(value)}
        </p>
      ))}
    </div>
  );
}

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
        {entity.roundType && (
          <>{formatRoundLabel(ROUND_TYPE_LABELS[entity.roundType], entity.roundTitle)}</>
        )}
        {/* Generated label only — a real recruiter name never reaches this
            page (CLAUDE.md hard constraint #1). */}
        {entity.recruiterLabel && <>{entity.recruiterLabel}</>}
      </p>
      {entry.entityType === 'round_rating' && <RoundContentDetails entity={entity} />}
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
  const [groups, setGroups] = useState<ModerationQueueGroup[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
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
      .then(setGroups)
      .catch((err: unknown) => {
        if (isSessionExpired(err)) router.push('/moderation/login');
        else setError(errorMessage(err));
      });
  }, [sessionChecked, router]);

  async function logout(): Promise<void> {
    await api.adminLogout().catch(() => undefined);
    router.push('/moderation/login');
  }

  function toggleExpanded(index: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
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
      setGroups(
        (prev) =>
          prev
            ?.map((g) => ({ ...g, entries: g.entries.filter((e) => e.id !== entry.id) }))
            .filter((g) => g.entries.length > 0) ?? null,
      );
    } catch (err) {
      if (isSessionExpired(err)) router.push('/moderation/login');
      else setError(errorMessage(err));
    }
  }

  // Session check hasn't resolved (or is redirecting to login) — render
  // nothing rather than a flash of the queue UI.
  if (!sessionChecked) return null;

  return (
    <PageContainer size="wide">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Moderation queue</h1>
          <p className="text-sm text-gray-500">
            One row per submission — click a row to see everything the candidate
            submitted for it. Approving makes an item publicly visible; rejecting
            and flagging keep it hidden.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/moderation/round-type-options" className="text-sm text-indigo-600 underline dark:text-indigo-400">
            Manage round-type field options
          </Link>
          <Button type="button" onClick={() => void logout()} variant="neutral">
            Log out
          </Button>
        </div>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <label className="flex flex-col text-sm sm:w-64">
        Your moderator name (optional)
        <input
          value={reviewedBy}
          onChange={(e) => setReviewedBy(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
        />
      </label>

      {/* null = still loading — must never look identical to an empty queue
          (the Phase 9 issue #61 rule). */}
      {groups === null && <p className="text-sm text-gray-500">Loading…</p>}
      {groups?.length === 0 && <EmptyState message="Queue is clear — nothing pending." />}

      {groups?.map((group, index) => {
        const isExpanded = expanded.has(index);
        return (
          <Card key={group.processId ?? `unknown-${index}`} as="section" className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => toggleExpanded(index)}
              className="flex w-full items-center justify-between gap-4 text-left"
              aria-expanded={isExpanded}
            >
              <div>
                <h2 className="font-medium">
                  {group.companyName} · {group.roleTitle}
                </h2>
                <p className="text-xs text-gray-500">
                  {group.entries.length} pending item{group.entries.length === 1 ? '' : 's'}
                </p>
              </div>
              <span className="text-sm text-gray-500">{isExpanded ? 'Hide details' : 'Review'}</span>
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-3 rounded-md border border-gray-100 p-3 dark:border-gray-800"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">{ENTITY_TYPE_LABEL[entry.entityType]}</h3>
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
                        variant="danger"
                      >
                        Reject
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void act(entry, 'flag')}
                        variant="warning"
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
                          className="rounded-md border border-gray-300 px-1 py-0.5 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
                        >
                          {FLAG_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </PageContainer>
  );
}
