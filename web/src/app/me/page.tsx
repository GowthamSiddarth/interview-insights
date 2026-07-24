'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, MyProcessSubmissions } from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';

const linkClass =
  'text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

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

// GitHub issue #149 — the one page where a candidate sees their own
// pending/rejected/flagged content, never just what's already public.
// Gated on the session-hint cookie (same pattern as NavBar/the wizard —
// GitHub issue #147/D32), not a GET /me/me network probe.
export default function MyReviewsPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [submissions, setSubmissions] = useState<MyProcessSubmissions[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    api
      .getMySubmissions()
      .then(setSubmissions)
      .catch((err: unknown) => setError(errorMessage(err)));
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
          rating before it&apos;s approved.
        </p>
      </header>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
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
          <section
            key={entry.processId}
            className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700"
          >
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
              <article
                key={r.id}
                className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm first:border-t-0 first:pt-0 dark:border-gray-700"
              >
                <p>
                  <strong>{r.roundTitle}</strong> ({roundTypeLabel(r.roundType)}) —{' '}
                  <span className={STATUS_CLASS[r.status]}>{statusLabel(r.status)}</span>
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  difficulty {r.difficulty} · fairness {r.fairness} · communication{' '}
                  {r.communicationFluency} · attentiveness {r.attentiveness}
                </p>
                {r.freeText && <p className="italic">&quot;{r.freeText}&quot;</p>}
              </article>
            ))}

            {entry.recruiterRatings.map((r) => (
              <article
                key={r.id}
                className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm first:border-t-0 first:pt-0 dark:border-gray-700"
              >
                <p>
                  Recruiter experience —{' '}
                  <span className={STATUS_CLASS[r.status]}>{statusLabel(r.status)}</span>
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  approachability {r.approachability} · response time {r.responseTime} ·
                  timeliness {r.timeliness} · communication {r.communicationQuality}
                </p>
                {r.freeText && <p className="italic">&quot;{r.freeText}&quot;</p>}
              </article>
            ))}

            {entry.overallReview && (
              <article className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm first:border-t-0 first:pt-0 dark:border-gray-700">
                <p>
                  Overall review —{' '}
                  <span className={STATUS_CLASS[entry.overallReview.status]}>
                    {statusLabel(entry.overallReview.status)}
                  </span>
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  overall experience {entry.overallReview.overallExperience} · would recommend{' '}
                  {entry.overallReview.wouldRecommend ? 'yes' : 'no'}
                </p>
                {entry.overallReview.reviewText && (
                  <p className="italic">&quot;{entry.overallReview.reviewText}&quot;</p>
                )}
              </article>
            )}
          </section>
        );
      })}
    </PageContainer>
  );
}
