'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  ApiError,
  ModerationFlagReason,
  ModerationQueueCategory,
  ModerationQueueClaimedBy,
  ModerationQueueEntity,
  ModerationQueueEntry,
  ModerationQueueGroup,
} from '@/lib/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import { formatRoundLabel } from '@/lib/format-round-label';
import { formatSlaStatus } from '@/lib/format-sla-status';
import { ROUND_TYPE_LABELS } from '../wizard/round-type-labels';

const ENTITY_TYPE_LABEL: Record<ModerationQueueEntry['entityType'], string> = {
  round_rating: 'Round rating',
  recruiter_rating: 'Recruiter rating',
  overall_review: 'Overall review',
  company: 'Company creation request',
};

const FLAG_REASONS: ModerationFlagReason[] = [
  'manual_report',
  'spam_pattern',
  'rate_limit',
  'duplicate',
];

// GitHub issue #371 (Phase 35) — the wire response never carries its own
// category field (see api.ts's own comment); it's derived purely from
// entityType, same rule the backend itself uses to build the index.
function categoryFor(entityType: ModerationQueueEntry['entityType']): ModerationQueueCategory {
  return entityType === 'company' ? 'create-company' : 'interview-review';
}

const CATEGORY_LABEL: Record<ModerationQueueCategory, string> = {
  'interview-review': 'Interview Review',
  'create-company': 'Create Company Request',
};

function CategoryBadge({ category }: { category: ModerationQueueCategory }) {
  return (
    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
      {CATEGORY_LABEL[category]}
    </span>
  );
}

// GitHub issue #487 (Phase 36, D80) — surfaces who (if anyone) currently
// owns an entry. Distinguishes "you" from another moderator by name,
// rather than just "claimed"/"unclaimed", since EntryActions below only
// offers a Release button for a claim the current moderator holds.
function ClaimBadge({
  claimedBy,
  isMine,
}: {
  claimedBy: ModerationQueueClaimedBy;
  isMine: boolean;
}) {
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Claimed by {isMine ? 'you' : claimedBy.username}
    </span>
  );
}

// GitHub issue #490 (Phase 36, D80) — a time-remaining/overdue indicator
// per entry, driven by the same slaDeadline #486/#487 already wired
// through end to end. Computed at render time (no live-ticking clock —
// out of scope for this issue; a moderator who leaves the page open for
// hours sees a slightly stale label until the next re-render, same
// staleness every other value on this page already tolerates between
// actions/reloads).
function SlaBadge({ slaDeadline }: { slaDeadline: string }) {
  const { label, overdue } = formatSlaStatus(slaDeadline);
  return (
    <span
      className={
        overdue
          ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }
    >
      {label}
    </span>
  );
}

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

// GitHub issue #369 (Phase 35) — a create-company request's own details,
// same shape as RoundContentDetails: the raw fields a moderator needs to
// decide whether to approve, nothing more.
function CompanyRequestDetails({ entity }: { entity: ModerationQueueEntity }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {entity.requestedCompanySlug && <p>slug: {entity.requestedCompanySlug}</p>}
      {entity.requestedCompanySizeBucket && <p>size: {entity.requestedCompanySizeBucket}</p>}
      {entity.requestedCompanyIndustry && <p>industry: {entity.requestedCompanyIndustry}</p>}
    </div>
  );
}

// GitHub issue #163 (Phase 19) — an advisory second opinion from an LLM
// triage pass, rendered distinctly from the deterministic fraud-check flag
// below: this is a suggestion to weigh, never a decision — the moderator
// still makes the call either way (CLAUDE.md hard constraint #2).
//
// GitHub issue #340 (Phase 32, D81) moved the triage call to an async
// service (review-analyzer) — a queue entry is now visible well before its
// verdict arrives, so "no verdict yet" is no longer safe to treat as
// nothing-to-show (issue #61's "loading vs. empty state" discipline).
// `company` entries are never triaged at all (not one of the three
// moderated content types) and render nothing here, same as before;
// for every other entityType, a null verdict now renders a distinct
// "Analysis pending" state instead of disappearing silently.
function AiModerationVerdict({
  entity,
  entityType,
}: {
  entity: ModerationQueueEntity;
  entityType: ModerationQueueEntry['entityType'];
}) {
  if (entityType === 'company') return null;

  const verdict = entity.moderationVerdict;
  if (!verdict) {
    return (
      <div className="rounded-md bg-gray-50 p-2 text-xs text-gray-500 italic dark:bg-gray-800 dark:text-gray-500">
        AI second opinion (advisory only): analysis pending
      </div>
    );
  }
  return (
    <div
      className={
        verdict.concerning
          ? 'rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-300'
          : 'rounded-md bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }
    >
      <p className="font-medium">
        AI second opinion (advisory only): {verdict.concerning ? 'flagged a concern' : 'no concerns found'}
      </p>
      <p>{verdict.summary}</p>
      {verdict.reasons.length > 0 && <p>{verdict.reasons.join('; ')}</p>}
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
      {entry.entityType === 'company' && <CompanyRequestDetails entity={entity} />}
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
      <AiModerationVerdict entity={entity} entityType={entry.entityType} />
    </div>
  );
}

// GitHub issue #371 (Phase 35) — shared by both the grouped queue view
// and the flat search-results view, so approve/reject/flag behave
// identically no matter which one a moderator is looking at. GitHub issue
// #487 (Phase 36) adds claim/release alongside — a claim is an optional
// "I've got this" signal, never a gate on approve/reject/flag, so those
// three stay enabled no matter who (if anyone) holds the claim.
function EntryActions({
  entry,
  flagReason,
  currentModeratorId,
  onFlagReasonChange,
  onAct,
  onClaim,
  onRelease,
}: {
  entry: ModerationQueueEntry;
  flagReason: ModerationFlagReason;
  currentModeratorId: string | null;
  onFlagReasonChange: (reason: ModerationFlagReason) => void;
  onAct: (action: 'approve' | 'reject' | 'flag') => void;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const isMine = entry.claimedBy !== null && entry.claimedBy.id === currentModeratorId;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={() => onAct('approve')}>
        Approve
      </Button>
      <Button type="button" onClick={() => onAct('reject')} variant="danger">
        Reject
      </Button>
      <Button type="button" onClick={() => onAct('flag')} variant="warning">
        Flag
      </Button>
      <label className="flex items-center gap-1 text-xs text-gray-500">
        flag reason
        <select
          aria-label={`Flag reason for ${entry.id}`}
          value={flagReason}
          onChange={(e) => onFlagReasonChange(e.target.value as ModerationFlagReason)}
          className="rounded-md border border-gray-300 px-1 py-0.5 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
        >
          {FLAG_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      {entry.claimedBy === null && (
        <Button type="button" onClick={onClaim} variant="neutral">
          Claim
        </Button>
      )}
      {entry.claimedBy !== null && (
        <>
          <ClaimBadge claimedBy={entry.claimedBy} isMine={isMine} />
          {isMine && (
            <Button type="button" onClick={onRelease} variant="neutral">
              Release
            </Button>
          )}
        </>
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
  // GitHub issue #487 (Phase 36) — the authenticated moderator's own id,
  // needed to tell "claimed by you" (offers a Release button) apart from
  // "claimed by someone else" (badge only) in EntryActions.
  const [currentModeratorId, setCurrentModeratorId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ModerationQueueGroup[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [reviewedBy, setReviewedBy] = useState('');
  const [flagReasonById, setFlagReasonById] = useState<Record<string, ModerationFlagReason>>({});
  const [error, setError] = useState<string | null>(null);
  // GitHub issue #371 (Phase 35) — a query and/or a category filter puts
  // the page into "search mode": the grouped-by-submission view is
  // replaced by a flat list of matches. Category alone (empty query)
  // still searches — "Any" category with an empty query is the only
  // combination that falls back to the normal grouped view.
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ModerationQueueCategory | ''>('');
  const [searchResults, setSearchResults] = useState<ModerationQueueEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearching = query.trim() !== '' || categoryFilter !== '';

  useEffect(() => {
    api
      .getAdminSession()
      .then((session) => {
        setCurrentModeratorId(session.id);
        setSessionChecked(true);
      })
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

  // Debounced — a query changes on every keystroke, and each search hits
  // real OpenSearch, not a client-side filter of already-loaded data.
  useEffect(() => {
    if (!sessionChecked) return;
    if (!isSearching) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timeout = setTimeout(() => {
      api
        .searchModerationQueue(query.trim(), categoryFilter)
        .then((results) => {
          setSearchResults(results);
          setSearchLoading(false);
        })
        .catch((err: unknown) => {
          setSearchLoading(false);
          if (isSessionExpired(err)) router.push('/moderation/login');
          else setError(errorMessage(err));
        });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSearching is derived from query/categoryFilter, already in the dep list
  }, [sessionChecked, query, categoryFilter, router]);

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
      setSearchResults((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
    } catch (err) {
      if (isSessionExpired(err)) router.push('/moderation/login');
      else setError(errorMessage(err));
    }
  }

  // GitHub issue #487 (Phase 36) — unlike act() above, claim/release never
  // remove the entry from view: the entry stays right where it is, just
  // with an updated claimedBy/claimedAt (taken from the response, so both
  // list views reflect it without a full requery).
  async function claimOrRelease(
    entry: ModerationQueueEntry,
    action: 'claim' | 'release',
  ): Promise<void> {
    setError(null);
    try {
      const updated =
        action === 'claim'
          ? await api.claimModerationEntry(entry.id)
          : await api.releaseModerationEntry(entry.id);
      const patch = (e: ModerationQueueEntry) =>
        e.id === entry.id ? { ...e, claimedBy: updated.claimedBy, claimedAt: updated.claimedAt } : e;
      setGroups(
        (prev) => prev?.map((g) => ({ ...g, entries: g.entries.map(patch) })) ?? null,
      );
      setSearchResults((prev) => prev?.map(patch) ?? null);
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

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm sm:w-64">
          Your moderator name (optional)
          <input
            value={reviewedBy}
            onChange={(e) => setReviewedBy(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          />
        </label>

        {/* GitHub issue #371 (Phase 35) — a query and/or category puts the
            page into search mode (see isSearching), replacing the grouped
            view below with a flat list of fuzzy matches. */}
        <label className="flex flex-col text-sm sm:w-64">
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, role, or review text…"
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col text-sm">
          Category
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ModerationQueueCategory | '')}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="">Any</option>
            <option value="interview-review">Interview review</option>
            <option value="create-company">Create company request</option>
          </select>
        </label>
      </div>

      {isSearching ? (
        <>
          {/* Loading is distinct from "zero matches" (Phase 9 issue #61
              rule) — a search in flight must never look identical to a
              confirmed-empty result. */}
          {searchLoading && <p className="text-sm text-gray-500">Searching…</p>}
          {!searchLoading && searchResults?.length === 0 && (
            <EmptyState message="No matches for this search." />
          )}
          {!searchLoading &&
            searchResults?.map((entry) => {
              const category = categoryFor(entry.entityType);
              const label =
                category === 'create-company'
                  ? entry.entity?.companyName
                  : `${entry.entity?.companyName ?? 'Unknown'} · ${entry.entity?.roleTitle ?? 'Unknown'}`;
              return (
                <Card key={entry.id} as="section" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{label}</h2>
                      <CategoryBadge category={category} />
                      <SlaBadge slaDeadline={entry.slaDeadline} />
                    </div>
                    <span className="text-xs text-gray-500">
                      submitted {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium">{ENTITY_TYPE_LABEL[entry.entityType]}</h3>
                  <EntityDetails entry={entry} />
                  <EntryActions
                    entry={entry}
                    flagReason={flagReasonById[entry.id] ?? 'manual_report'}
                    currentModeratorId={currentModeratorId}
                    onFlagReasonChange={(reason) =>
                      setFlagReasonById((prev) => ({ ...prev, [entry.id]: reason }))
                    }
                    onAct={(action) => void act(entry, action)}
                    onClaim={() => void claimOrRelease(entry, 'claim')}
                    onRelease={() => void claimOrRelease(entry, 'release')}
                  />
                </Card>
              );
            })}
        </>
      ) : (
        <>
          {/* null = still loading — must never look identical to an empty
              queue (the Phase 9 issue #61 rule). */}
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
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium">{ENTITY_TYPE_LABEL[entry.entityType]}</h3>
                            <SlaBadge slaDeadline={entry.slaDeadline} />
                          </div>
                          <span className="text-xs text-gray-500">
                            submitted {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <EntityDetails entry={entry} />
                        <EntryActions
                          entry={entry}
                          flagReason={flagReasonById[entry.id] ?? 'manual_report'}
                          currentModeratorId={currentModeratorId}
                          onFlagReasonChange={(reason) =>
                            setFlagReasonById((prev) => ({ ...prev, [entry.id]: reason }))
                          }
                          onAct={(action) => void act(entry, action)}
                          onClaim={() => void claimOrRelease(entry, 'claim')}
                          onRelease={() => void claimOrRelease(entry, 'release')}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </PageContainer>
  );
}
