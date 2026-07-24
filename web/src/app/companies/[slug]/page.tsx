'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  ApiError,
  Company,
  CompanyAnalytics,
  CompanyReviewItem,
  CompanyReviewsPage,
} from '@/lib/api';
import { ScoreDisplay } from '@/components/ScoreDisplay';
import { EmptyState } from '@/components/EmptyState';
import { GatedSection } from '@/components/GatedSection';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

const PAGE_SIZE = 10;

function sizeBucketLabel(bucket: Company['sizeBucket']): string {
  return bucket[0].toUpperCase() + bucket.slice(1);
}

function roundTypeLabel(roundType: string): string {
  return roundType
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

function ReviewItem({ review }: { review: CompanyReviewItem }) {
  return (
    <article className="flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm first:border-t-0 first:pt-0 dark:border-gray-700">
      <p className="font-medium">
        {review.roleTitle} · {roundTypeLabel(review.roundType)} ({review.roundTitle})
      </p>
      <p className="text-gray-600 dark:text-gray-400">
        difficulty {review.difficulty} · fairness {review.fairness} · communication{' '}
        {review.communicationFluency} · attentiveness {review.attentiveness}
      </p>
      {review.freeText && <p className="italic">&quot;{review.freeText}&quot;</p>}
    </article>
  );
}

export default function CompanyProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [analytics, setAnalytics] = useState<CompanyAnalytics | null>(null);
  const [reviews, setReviews] = useState<CompanyReviewsPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Session-hint cookie, not a GET /auth/me poll — same tri-state idiom
  // NavBar/the wizard already use (D32): null while unchecked, so a gated
  // section never flashes before the real state is known.
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    api
      .getCompanyBySlug(slug)
      .then((c) => {
        setCompany(c);
        return Promise.all([api.getCompanyAnalytics(c.id), api.listCompanyReviews(c.id, 1, PAGE_SIZE)]);
      })
      .then(([a, r]) => {
        setAnalytics(a);
        setReviews(r);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [slug]);

  useEffect(() => {
    // Skip the initial page (already fetched above alongside the company).
    if (!company || page === 1) return;
    setReviews(null);
    api
      .listCompanyReviews(company.id, page, PAGE_SIZE)
      .then(setReviews)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [company, page]);

  if (error) {
    return (
      <PageContainer>
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </PageContainer>
    );
  }

  // null = still loading, distinct from "confirmed absent" (Phase 9 issue
  // #61 rule) — never render a blank page indistinguishable from a slow one.
  if (!company) {
    return (
      <PageContainer>
        <p className="text-sm text-gray-500">Loading…</p>
      </PageContainer>
    );
  }

  const totalPages = reviews ? Math.max(1, Math.ceil(reviews.total / PAGE_SIZE)) : 1;

  return (
    <PageContainer>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{company.name}</h1>
        <p className="text-sm text-gray-500">
          {[company.industry, sizeBucketLabel(company.sizeBucket)].filter(Boolean).join(' · ')}
        </p>
        <Link
          href={`/companies/${company.slug}/analytics`}
          className="text-sm text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Full analytics breakdown
        </Link>
      </header>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">Overall experience</h2>
        {!analytics ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : analytics.overall ? (
          <dl className="grid grid-cols-2 gap-4">
            <ScoreDisplay
              label="Overall experience"
              value={analytics.overall.scores.overallExperience}
              sampleSize={analytics.overall.sampleSize}
            />
            <ScoreDisplay
              label="Would recommend"
              value={analytics.overall.scores.wouldRecommendPct}
              sampleSize={analytics.overall.sampleSize}
              suffix="%"
            />
          </dl>
        ) : (
          <EmptyState message="Not enough reviews yet" />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">By round type</h2>
        {!analytics ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : analytics.roundTypes.length === 0 ? (
          <EmptyState message="Not enough reviews yet" />
        ) : (
          <GatedSection loggedIn={candidateSession} prompt="Log in to see the full round-type breakdown">
            <div className="flex flex-col gap-4">
              {analytics.roundTypes.map((rt) => (
                <div key={rt.roundType}>
                  <h3 className="mb-2 text-sm font-medium">{roundTypeLabel(rt.roundType)}</h3>
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <ScoreDisplay label="Difficulty" value={rt.scores.difficulty} sampleSize={rt.sampleSize} />
                    <ScoreDisplay label="Fairness" value={rt.scores.fairness} sampleSize={rt.sampleSize} />
                    <ScoreDisplay
                      label="Communication"
                      value={rt.scores.communicationFluency}
                      sampleSize={rt.sampleSize}
                    />
                  </dl>
                </div>
              ))}
            </div>
          </GatedSection>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">Reviews</h2>
        {reviews === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : reviews.items.length === 0 ? (
          <EmptyState message="No approved reviews yet." />
        ) : (
          <>
            <p className="text-sm text-gray-500">
              {reviews.total} review{reviews.total === 1 ? '' : 's'}
            </p>
            <div className="flex flex-col gap-4">
              <ReviewItem review={reviews.items[0]} />
            </div>
            {(reviews.items.length > 1 || totalPages > 1) && (
              <GatedSection
                loggedIn={candidateSession}
                prompt={`Log in to see the other ${reviews.total - 1} review${reviews.total - 1 === 1 ? '' : 's'}`}
              >
                <div className="flex flex-col gap-4">
                  {reviews.items.slice(1).map((r) => (
                    <ReviewItem key={r.id} review={r} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center gap-3 text-sm">
                    <Button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="disabled:opacity-40"
                    >
                      Previous
                    </Button>
                    <span className="text-gray-500">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="disabled:opacity-40"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </GatedSection>
            )}
          </>
        )}
      </section>
    </PageContainer>
  );
}
