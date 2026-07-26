'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  Company,
  CompanySearchResult,
  ReviewSearchResult,
  Round,
} from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

function roundTypeLabel(roundType: string): string {
  return roundType
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

// Landing page — searching/browsing reviews is the primary verb here now,
// writing one is reachable via the "Write a review" link once a company is
// selected (or from NavBar), not the first thing a visitor sees. The wizard
// itself lives at /search (see that file), receiving the chosen company via
// query params so it never needs its own company-picker.
export default function SearchPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyQuery, setCompanyQuery] = useState('');
  // null = haven't searched yet; [] = searched, zero matches.
  const [companyResults, setCompanyResults] = useState<CompanySearchResult[] | null>(null);
  // A request in flight is a third state, distinct from both of the above
  // — GitHub issue #61 found that without it, a first search showed
  // nothing (identical to "haven't searched yet"), and a repeat search
  // silently kept showing the previous, now-stale results with no
  // indication a new one was running. Confirmed live against a
  // deliberately delayed response, not just theorized from the code.
  const [companySearching, setCompanySearching] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CompanySearchResult | null>(null);
  const [reviewResults, setReviewResults] = useState<ReviewSearchResult[] | null>(null);
  const [reviewSearching, setReviewSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick-select buttons, one per existing company — the same shape the
  // wizard's old company picker used, relocated here now that discovery is
  // this page's job.
  useEffect(() => {
    api.listCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  // Plain onSubmit handlers, not <form action={fn}> — React 19 batches a
  // form action's own synchronous-before-the-first-await state updates
  // into the action's transition and doesn't flush them until an await
  // resolves, so a `setSearching(true)` called before `await api...(...)`
  // never rendered (confirmed live: GitHub issue #61). A normal event
  // handler's setState calls flush immediately, same as any other click.
  async function handleCompanySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    const q = String(formData.get('q'));
    setCompanyQuery(q);
    setCompanySearching(true);
    try {
      setCompanyResults(await api.searchCompanies(q));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCompanySearching(false);
    }
  }

  function handleSelectCompany(company: CompanySearchResult) {
    setSelectedCompany(company);
    setReviewResults(null);
  }

  async function handleReviewSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCompany) return;
    const formData = new FormData(event.currentTarget);
    setError(null);
    const roleTitle = String(formData.get('roleTitle') || '') || undefined;
    const roundType = (String(formData.get('roundType') || '') || undefined) as
      | Round['roundType']
      | undefined;
    const dateFrom = String(formData.get('dateFrom') || '') || undefined;
    const dateTo = String(formData.get('dateTo') || '') || undefined;
    setReviewSearching(true);
    try {
      setReviewResults(
        await api.searchReviews({
          companyId: selectedCompany.id,
          roleTitle,
          roundType,
          dateFrom,
          dateTo,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReviewSearching(false);
    }
  }

  return (
    <PageContainer size="wide">
      <header>
        <h1 className="text-2xl font-semibold">Interview Insights</h1>
        <p className="text-sm text-gray-500">
          Find a company, then browse and filter its approved reviews.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="font-medium">1. Find a company</h2>
        <form onSubmit={handleCompanySearch} className="flex gap-2">
          <input
            name="q"
            required
            placeholder="Company name"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          />
          <Button type="submit">Search</Button>
        </form>

        {companies.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-500">Or pick one directly:</p>
            <div className="flex flex-wrap gap-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCompany(c)}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {companySearching ? (
          <p className="text-sm text-gray-500">Searching…</p>
        ) : (
          companyResults !== null &&
          (companyResults.length === 0 ? (
            <EmptyState message={`No companies match "${companyQuery}".`} />
          ) : (
            <ul className="flex flex-col gap-1">
              {companyResults.map((company) => (
                <li
                  key={company.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm transition-colors ${
                    selectedCompany?.id === company.id
                      ? 'border-indigo-600 dark:border-indigo-400'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  <button
                    onClick={() => handleSelectCompany(company)}
                    className="flex-1 text-left hover:underline"
                  >
                    {company.name}{' '}
                    <span className="text-gray-500">({company.sizeBucket})</span>
                  </button>
                  {/* The public profile page (Phase 15) — distinct from the
                      button above, which only selects the company for
                      step 2's review filtering below. */}
                  <Link
                    href={`/companies/${company.slug}`}
                    className="shrink-0 text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    View profile
                  </Link>
                </li>
              ))}
            </ul>
          )))
        }
      </Card>

      {selectedCompany && (
        <Card as="section" className="flex flex-col gap-3">
          <h2 className="font-medium">
            2. Browse reviews for {selectedCompany.name}{' '}
            <Link
              href={`/companies/${selectedCompany.slug}`}
              className="text-sm font-normal text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              (view profile)
            </Link>{' '}
            <Link
              href={`/write-review?companyId=${selectedCompany.id}&companySlug=${selectedCompany.slug}&companyName=${encodeURIComponent(selectedCompany.name)}`}
              className="text-sm font-normal text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Write a review
            </Link>
          </h2>
          <form onSubmit={handleReviewSearch} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col text-sm">
              Role title
              <input name="roleTitle" className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="flex flex-col text-sm">
              Round type
              <select name="roundType" className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900">
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
              <input type="date" name="dateFrom" className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <label className="flex flex-col text-sm">
              To
              <input type="date" name="dateTo" className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900" />
            </label>
            <Button type="submit" className="col-span-full">
              Search reviews
            </Button>
          </form>

          {reviewSearching ? (
            <p className="text-sm text-gray-500">Searching…</p>
          ) : (
            reviewResults !== null &&
            (reviewResults.length === 0 ? (
              <EmptyState message="No reviews match these filters." />
            ) : (
              <ul className="flex flex-col gap-2">
                {reviewResults.map((review) => (
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
            )))
          }
        </Card>
      )}
    </PageContainer>
  );
}
