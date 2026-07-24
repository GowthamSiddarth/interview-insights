'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  MyProcessSubmissions,
  MySubmissionOverallReview,
  MySubmissionRecruiterRating,
  MySubmissionRoundRating,
} from '@/lib/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

const STATUS_CLASS: Record<string, string> = {
  pending: 'text-amber-700 dark:text-amber-400',
  approved: 'text-green-700 dark:text-green-400',
  rejected: 'text-red-700 dark:text-red-400',
  flagged: 'text-amber-700 dark:text-amber-400',
};

function statusLabel(status: string): string {
  return status[0].toUpperCase() + status.slice(1);
}

function roundTypeLabel(roundType: string): string {
  return roundType
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function outcomeLabel(outcome: string): string {
  return outcome
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';
const itemClass =
  'flex flex-col gap-2 border-t border-gray-200 pt-3 text-sm first:border-t-0 first:pt-0 dark:border-gray-700';

// GitHub issue #150: an edit never modifies public content in place — the
// server resets it to `pending` and re-enqueues, so after a successful
// save/delete the parent just refetches the whole list rather than trying
// to patch nested state by hand.
function RoundRatingItem({
  rating,
  onChanged,
}: {
  rating: MySubmissionRoundRating;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    difficulty: rating.difficulty,
    fairness: rating.fairness,
    communicationFluency: rating.communicationFluency,
    attentiveness: rating.attentiveness,
    biasSignal: rating.biasSignal,
    freeText: rating.freeText ?? '',
  });

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.updateRoundRating(rating.roundId, rating.id, {
        ...form,
        freeText: form.freeText || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this round rating? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRoundRating(rating.roundId, rating.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <article className={itemClass}>
        <p>
          <strong>{rating.roundTitle}</strong> ({roundTypeLabel(rating.roundType)})
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            ['difficulty', 'fairness', 'communicationFluency', 'attentiveness', 'biasSignal'] as const
          ).map((field) => (
            <label key={field} className="flex flex-col text-xs">
              {field}
              <input
                type="number"
                min={1}
                max={5}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: Number(e.target.value) }))}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-col text-xs">
          Comments
          <textarea
            value={form.freeText}
            onChange={(e) => setForm((f) => ({ ...f, freeText: e.target.value }))}
            className={inputClass}
          />
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            onClick={() => setEditing(false)}
            variant="neutral"
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={itemClass}>
      <p>
        <strong>{rating.roundTitle}</strong> ({roundTypeLabel(rating.roundType)}) —{' '}
        <span className={STATUS_CLASS[rating.status]}>{statusLabel(rating.status)}</span>
      </p>
      <p className="text-gray-600 dark:text-gray-400">
        difficulty {rating.difficulty} · fairness {rating.fairness} · communication{' '}
        {rating.communicationFluency} · attentiveness {rating.attentiveness}
      </p>
      {rating.freeText && <p className="italic">&quot;{rating.freeText}&quot;</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => setEditing(true)}
          variant="neutral"
          disabled={busy}
        >
          Edit
        </Button>
        <Button
          type="button"
          onClick={() => void remove()}
          variant="danger"
          disabled={busy}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

function RecruiterRatingItem({
  rating,
  onChanged,
}: {
  rating: MySubmissionRecruiterRating;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    approachability: rating.approachability,
    responseTime: rating.responseTime,
    timeliness: rating.timeliness,
    communicationQuality: rating.communicationQuality,
    freeText: rating.freeText ?? '',
  });

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.updateRecruiterRating(rating.recruiterInteractionId, rating.id, {
        ...form,
        freeText: form.freeText || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this recruiter rating? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRecruiterRating(rating.recruiterInteractionId, rating.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <article className={itemClass}>
        <p>Recruiter experience</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            ['approachability', 'responseTime', 'timeliness', 'communicationQuality'] as const
          ).map((field) => (
            <label key={field} className="flex flex-col text-xs">
              {field}
              <input
                type="number"
                min={1}
                max={5}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: Number(e.target.value) }))}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-col text-xs">
          Comments
          <textarea
            value={form.freeText}
            onChange={(e) => setForm((f) => ({ ...f, freeText: e.target.value }))}
            className={inputClass}
          />
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            onClick={() => setEditing(false)}
            variant="neutral"
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={itemClass}>
      <p>
        Recruiter experience — <span className={STATUS_CLASS[rating.status]}>{statusLabel(rating.status)}</span>
      </p>
      <p className="text-gray-600 dark:text-gray-400">
        approachability {rating.approachability} · response time {rating.responseTime} · timeliness{' '}
        {rating.timeliness} · communication {rating.communicationQuality}
      </p>
      {rating.freeText && <p className="italic">&quot;{rating.freeText}&quot;</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => setEditing(true)}
          variant="neutral"
          disabled={busy}
        >
          Edit
        </Button>
        <Button
          type="button"
          onClick={() => void remove()}
          variant="danger"
          disabled={busy}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

function OverallReviewItem({
  processId,
  review,
  onChanged,
}: {
  processId: string;
  review: MySubmissionOverallReview;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    overallExperience: review.overallExperience,
    wouldRecommend: review.wouldRecommend,
    reviewText: review.reviewText ?? '',
  });

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.updateOverallReview(processId, {
        ...form,
        reviewText: form.reviewText || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this overall review? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteOverallReview(processId);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <article className={itemClass}>
        <p>Overall review</p>
        <label className="flex flex-col text-xs">
          Overall experience (1-5)
          <input
            type="number"
            min={1}
            max={5}
            value={form.overallExperience}
            onChange={(e) =>
              setForm((f) => ({ ...f, overallExperience: Number(e.target.value) }))
            }
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.wouldRecommend}
            onChange={(e) => setForm((f) => ({ ...f, wouldRecommend: e.target.checked }))}
          />
          Would recommend
        </label>
        <label className="flex flex-col text-xs">
          Review text
          <textarea
            value={form.reviewText}
            onChange={(e) => setForm((f) => ({ ...f, reviewText: e.target.value }))}
            className={inputClass}
          />
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            onClick={() => setEditing(false)}
            variant="neutral"
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={itemClass}>
      <p>
        Overall review —{' '}
        <span className={STATUS_CLASS[review.status]}>{statusLabel(review.status)}</span>
      </p>
      <p className="text-gray-600 dark:text-gray-400">
        overall experience {review.overallExperience} · would recommend{' '}
        {review.wouldRecommend ? 'yes' : 'no'}
      </p>
      {review.reviewText && <p className="italic">&quot;{review.reviewText}&quot;</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => setEditing(true)}
          variant="neutral"
          disabled={busy}
        >
          Edit
        </Button>
        <Button
          type="button"
          onClick={() => void remove()}
          variant="danger"
          disabled={busy}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

// GitHub issue #151 (GDPR erasure) — permanently deletes the account and
// everything it submitted. A plain window.confirm (same as every other
// delete on this page) but with wording explicit about scope and
// irreversibility, since this is a much bigger action than deleting one
// item. A hard navigation (not router.push) afterward, matching D32's
// verify-redirect precedent: NavBar is mounted once in the root layout
// and won't otherwise notice the session is gone.
function DeleteAccountSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eraseAccount(): Promise<void> {
    if (
      !window.confirm(
        'Permanently delete your account and every review you\'ve submitted? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      window.location.href = '/';
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-red-300 bg-white p-4 shadow-sm dark:border-red-800 dark:bg-gray-900">
      <h2 className="font-medium text-red-700 dark:text-red-400">Danger zone</h2>
      <p className="text-sm text-gray-500">
        Permanently delete your account and every review you&apos;ve submitted, across every
        status. This cannot be undone.
      </p>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <Button
        type="button"
        onClick={() => void eraseAccount()}
        variant="danger" className="self-start"
        disabled={busy}
      >
        Delete my account
      </Button>
    </section>
  );
}

// GitHub issue #149 — the one page where a candidate sees their own
// pending/rejected/flagged content, never just what's already public.
// Gated on the session-hint cookie (same pattern as NavBar/the wizard —
// GitHub issue #147/D32), not a GET /me/me network probe. GitHub issue
// #150 added the Edit/Delete controls on each item below; #151 added the
// account-erasure "Danger zone" section at the bottom.
export default function MyReviewsPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [submissions, setSubmissions] = useState<MyProcessSubmissions[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(api.hasCandidateSessionHint());
  }, []);

  function reload(): void {
    api
      .getMySubmissions()
      .then(setSubmissions)
      .catch((err: unknown) => setError(errorMessage(err)));
  }

  useEffect(() => {
    if (!loggedIn) return;
    reload();
  }, [loggedIn]);

  if (loggedIn === null) {
    return (
      <PageContainer>
        <p className="text-sm text-gray-500">Loading…</p>
      </PageContainer>
    );
  }

  if (!loggedIn) {
    return (
      <PageContainer>
        <header>
          <h1 className="text-2xl font-semibold">My reviews</h1>
        </header>
        <p className="text-sm text-gray-500">
          <Link href="/login" className={linkClass}>
            Log in
          </Link>{' '}
          to see your own submissions.
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">My reviews</h1>
        <p className="text-sm text-gray-500">
          Every submission you&apos;ve made, across every status — the one place you can see a
          rating before it&apos;s approved. Editing resets a submission back to pending review;
          deleting is permanent.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* null = still loading, distinct from "confirmed empty" — Phase 9
          issue #61 rule. */}
      {submissions === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {submissions?.length === 0 && (
        <EmptyState message="You haven't submitted anything yet." />
      )}

      {submissions?.map((entry) => {
        const isEmpty =
          entry.roundRatings.length === 0 &&
          entry.recruiterRatings.length === 0 &&
          !entry.overallReview;

        return (
          <Card as="section" key={entry.processId} className="flex flex-col gap-3">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">
                  {entry.companyName} — {entry.roleTitle}
                </h2>
                <p className="text-xs text-gray-500">
                  {outcomeLabel(entry.outcome)} · started{' '}
                  {new Date(entry.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Link href={`/companies/${entry.companySlug}`} className={`${linkClass} text-sm`}>
                View company profile
              </Link>
            </header>

            {isEmpty && (
              <p className="text-sm text-gray-500 italic">
                No ratings submitted for this process yet.
              </p>
            )}

            {entry.roundRatings.map((r) => (
              <RoundRatingItem key={r.id} rating={r} onChanged={reload} />
            ))}

            {entry.recruiterRatings.map((r) => (
              <RecruiterRatingItem key={r.id} rating={r} onChanged={reload} />
            ))}

            {entry.overallReview && (
              <OverallReviewItem
                key={entry.overallReview.id}
                processId={entry.processId}
                review={entry.overallReview}
                onChanged={reload}
              />
            )}
          </Card>
        );
      })}

      <DeleteAccountSection />
    </PageContainer>
  );
}
