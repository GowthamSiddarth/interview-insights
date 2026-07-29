'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  ApiError,
  Company,
  CompanyAnalytics,
  CompanyReviewGroup,
  CompanyReviewItem,
  CompanyReviewsPage,
  ReviewSearchResult,
  Round,
} from '@/lib/api';
import { ScoreDisplay } from '@/components/ScoreDisplay';
import { EmptyState } from '@/components/EmptyState';
import { GatedSection } from '@/components/GatedSection';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';
import { formatRoundLabel } from '@/lib/format-round-label';

const PAGE_SIZE = 10;

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

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
    <article className="flex flex-col gap-1 text-sm">
      <p className="font-medium">
        {formatRoundLabel(roundTypeLabel(review.roundType), review.roundTitle)}
      </p>
      <p className="text-gray-600 dark:text-gray-400">
        difficulty {review.difficulty} · fluency {review.fluency} · clarity{' '}
        {review.clarity} · focus {review.focus}
      </p>
      {review.freeText && <p className="italic">&quot;{review.freeText}&quot;</p>}
    </article>
  );
}

// GitHub issue #347: one collapsed row per submission (not per round),
// expanding on click to reveal every rated round's full detail — the
// same flat-list fix Phase 29 issue #315 already applied to the
// moderation queue.
function ReviewGroupItem({ group }: { group: CompanyReviewGroup }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-t border-gray-200 pt-3 first:border-t-0 first:pt-0 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-4 text-left text-sm"
        aria-expanded={expanded}
      >
        <div>
          <p className="font-medium">{group.roleTitle}</p>
          <p className="text-xs text-gray-500">
            {group.entries.length} round{group.entries.length === 1 ? '' : 's'} rated
          </p>
        </div>
        <span className="text-gray-500">{expanded ? 'Hide details' : 'View details'}</span>
      </button>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          {group.entries.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </div>
      )}
    </div>
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
  // GitHub issue #424 (Phase 38) — review filtering, merged into the
  // Reviews section itself rather than a separate section: null = no
  // filter applied yet (show the default grouped/paginated list below),
  // non-null = show these flat filtered results instead.
  const [filterResults, setFilterResults] = useState<ReviewSearchResult[] | null>(null);
  const [filterSearching, setFilterSearching] = useState(false);
  // GitHub issue #425 (Phase 38) fix — tracks whether *this slug's* initial
  // bundled fetch (below) has completed, as opposed to the old `page === 1`
  // check, which also (incorrectly) skipped refetching on a Previous click
  // that returned to page 1, leaving `reviews` stuck showing the last
  // fetched page. A ref, not state: flipping it must not itself trigger a
  // render/effect run.
  const initialReviewsLoadedRef = useRef(false);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  // Resetting `page` here (not just leaving it at whatever it was) fixes
  // the same class of stale-page bug — without it, navigating from company
  // A's page 2 straight to company B's profile would fetch company B
  // starting on page 2.
  useEffect(() => {
    initialReviewsLoadedRef.current = false;
    setPage(1);
    setFilterResults(null);
    api
      .getCompanyBySlug(slug)
      .then((c) => {
        setCompany(c);
        return Promise.all([api.getCompanyAnalytics(c.id), api.listCompanyReviews(c.id, 1, PAGE_SIZE)]);
      })
      .then(([a, r]) => {
        setAnalytics(a);
        setReviews(r);
        initialReviewsLoadedRef.current = true;
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [slug]);

  // Handles every page change *after* the initial bundled fetch above —
  // including a Previous click that returns to page 1, which the old
  // `page === 1` guard incorrectly skipped (GitHub issue #425).
  useEffect(() => {
    if (!company || !initialReviewsLoadedRef.current) return;
    setReviews(null);
    api
      .listCompanyReviews(company.id, page, PAGE_SIZE)
      .then(setReviews)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [company, page]);

  async function handleFilterSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) return;
    const formData = new FormData(event.currentTarget);
    const roleTitle = String(formData.get('roleTitle') || '') || undefined;
    const roundType = (String(formData.get('roundType') || '') || undefined) as
      | Round['roundType']
      | undefined;
    const dateFrom = String(formData.get('dateFrom') || '') || undefined;
    const dateTo = String(formData.get('dateTo') || '') || undefined;
    setFilterSearching(true);
    try {
      setFilterResults(
        await api.searchReviews({ companyId: company.id, roleTitle, roundType, dateFrom, dateTo }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setFilterSearching(false);
    }
  }

  function handleClearFilters() {
    setFilterResults(null);
  }

  if (error) {
    return (
      <PageContainer size="wide">
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </PageContainer>
    );
  }

  // null = still loading, distinct from "confirmed absent" (Phase 9 issue
  // #61 rule) — never render a blank page indistinguishable from a slow one.
  if (!company) {
    return (
      <PageContainer size="wide">
        <p className="text-sm text-gray-500">Loading…</p>
      </PageContainer>
    );
  }

  const totalPages = reviews ? Math.max(1, Math.ceil(reviews.total / PAGE_SIZE)) : 1;

  return (
    <PageContainer size="wide">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{company.name}</h1>
        <p className="text-sm text-gray-500">
          {[company.industry, sizeBucketLabel(company.sizeBucket)].filter(Boolean).join(' · ')}
        </p>
        <span className="flex flex-wrap gap-3">
          <Link
            href={`/companies/${company.slug}/analytics`}
            className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            Full analytics breakdown
          </Link>
          <Link
            href={`/write-review?companyId=${company.id}&companySlug=${company.slug}&companyName=${encodeURIComponent(company.name)}`}
            className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            Write a review
          </Link>
        </span>
      </header>

      <Card as="section" className="flex flex-col gap-3">
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
      </Card>

      <Card as="section" className="flex flex-col gap-3">
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
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <ScoreDisplay label="Difficulty" value={rt.scores.difficulty} sampleSize={rt.sampleSize} />
                    <ScoreDisplay label="Fluency" value={rt.scores.fluency} sampleSize={rt.sampleSize} />
                    <ScoreDisplay label="Clarity" value={rt.scores.clarity} sampleSize={rt.sampleSize} />
                    <ScoreDisplay label="Focus" value={rt.scores.focus} sampleSize={rt.sampleSize} />
                  </dl>
                </div>
              ))}
            </div>
          </GatedSection>
        )}
      </Card>

      <Card as="section" className="flex flex-col gap-3">
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

            {/* GitHub issue #429 (Phase 38): the filter form sits directly under
                the header/count, before any review content — not sandwiched
                after the always-visible first review below. It's gated with a
                plain `candidateSession` check rather than nested inside the
                GatedSection below: nesting it there would either force the
                free preview review behind the login gate too (breaking the
                anonymous-visitor hook, issue #226/D40) or require a second,
                duplicate "Log in..." prompt. */}
            {candidateSession && (reviews.items.length > 1 || totalPages > 1) && (
              <form
                onSubmit={handleFilterSearch}
                className="grid grid-cols-2 gap-2 border-b border-gray-200 pb-4 sm:grid-cols-4 dark:border-gray-700"
              >
                <label className="flex flex-col text-sm">
                  Role title
                  <input name="roleTitle" className={inputClass} />
                </label>
                <label className="flex flex-col text-sm">
                  Round type
                  <select name="roundType" className={inputClass}>
                    <option value="">Any</option>
                    <option value="coding">Coding</option>
                    <option value="system_design">System design</option>
                    <option value="behavioral">Behavioral</option>
                    <option value="leadership">Leadership</option>
                    <option value="case_study">Case study</option>
                    <option value="assessment">Assessment</option>
                    <option value="take_home">Take-home</option>
                    <option value="tech_screening">Tech Screening</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="flex flex-col text-sm">
                  From
                  <input type="date" name="dateFrom" className={inputClass} />
                </label>
                <label className="flex flex-col text-sm">
                  To
                  <input type="date" name="dateTo" className={inputClass} />
                </label>
                <Button type="submit" className={filterResults !== null ? '' : 'col-span-full'}>
                  Search reviews
                </Button>
                {filterResults !== null && (
                  <Button type="button" variant="neutral" onClick={handleClearFilters}>
                    Clear filters
                  </Button>
                )}
              </form>
            )}

            {filterSearching ? (
              <p className="text-sm text-gray-500">Searching…</p>
            ) : filterResults !== null ? (
              // A filter replaces the *entire* default display (both the free
              // preview and the gated rest) — showing an unrelated free
              // preview alongside a differently-scoped filtered list would be
              // confusing.
              filterResults.length === 0 ? (
                <EmptyState message="No reviews match these filters." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {filterResults.map((review) => (
                    <li
                      key={review.id}
                      className="rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <p className="font-medium">
                        {review.roleTitle} — {roundTypeLabel(review.roundType)}
                      </p>
                      {review.freeText && <p className="text-gray-500">{review.freeText}</p>}
                      <p className="text-xs text-gray-400">
                        Difficulty {review.difficulty} · Fluency {review.fluency} ·
                        Clarity {review.clarity} · Focus {review.focus}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  <ReviewGroupItem group={reviews.items[0]} />
                </div>
                {(reviews.items.length > 1 || totalPages > 1) && (
                  <GatedSection
                    loggedIn={candidateSession}
                    prompt={`Log in to filter and see the other ${reviews.total - 1} review${reviews.total - 1 === 1 ? '' : 's'}`}
                  >
                    <div className="flex flex-col gap-4">
                      {reviews.items.slice(1).map((g) => (
                        <ReviewGroupItem key={g.processId} group={g} />
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
          </>
        )}
      </Card>
    </PageContainer>
  );
}
