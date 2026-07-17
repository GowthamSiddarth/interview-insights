'use client';

import { FormEvent, useState } from 'react';
import {
  api,
  ApiError,
  CompanySearchResult,
  ReviewSearchResult,
  Round,
} from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
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

export default function SearchPage() {
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
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-gray-500">
          Find a company, then browse and filter its approved reviews.
        </p>
      </header>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">1. Find a company</h2>
        <form onSubmit={handleCompanySearch} className="flex gap-2">
          <input
            name="q"
            required
            placeholder="Company name"
            className="flex-1 rounded border px-2 py-1 text-sm dark:bg-gray-900"
          />
          <Button type="submit">Search</Button>
        </form>

        {companySearching ? (
          <p className="text-sm text-gray-500">Searching…</p>
        ) : (
          companyResults !== null &&
          (companyResults.length === 0 ? (
            <EmptyState message={`No companies match "${companyQuery}".`} />
          ) : (
            <ul className="flex flex-col gap-1">
              {companyResults.map((company) => (
                <li key={company.id}>
                  <button
                    onClick={() => {
                      setSelectedCompany(company);
                      setReviewResults(null);
                    }}
                    className={`w-full rounded border px-3 py-1 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      selectedCompany?.id === company.id
                        ? 'border-indigo-600 dark:border-indigo-400'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {company.name}{' '}
                    <span className="text-gray-500">({company.sizeBucket})</span>
                  </button>
                </li>
              ))}
            </ul>
          )))
        }
      </section>

      {selectedCompany && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">2. Browse reviews for {selectedCompany.name}</h2>
          <form onSubmit={handleReviewSearch} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col text-sm">
              Role title
              <input name="roleTitle" className="rounded border px-2 py-1 dark:bg-gray-900" />
            </label>
            <label className="flex flex-col text-sm">
              Round type
              <select name="roundType" className="rounded border px-2 py-1 dark:bg-gray-900">
                <option value="">Any</option>
                <option value="coding">Coding</option>
                <option value="system_design">System design</option>
                <option value="behavioral">Behavioral</option>
                <option value="leadership">Leadership</option>
                <option value="case_study">Case study</option>
                <option value="assessment">Assessment</option>
                <option value="take_home">Take-home</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col text-sm">
              From
              <input type="date" name="dateFrom" className="rounded border px-2 py-1 dark:bg-gray-900" />
            </label>
            <label className="flex flex-col text-sm">
              To
              <input type="date" name="dateTo" className="rounded border px-2 py-1 dark:bg-gray-900" />
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
                    className="rounded border border-gray-200 p-2 text-sm dark:border-gray-700"
                  >
                    <p className="font-medium">
                      {review.roleTitle} — {roundTypeLabel(review.roundType)}
                    </p>
                    {review.freeText && <p className="text-gray-500">{review.freeText}</p>}
                    <p className="text-xs text-gray-400">
                      Difficulty {review.difficulty} · Fairness {review.fairness} ·
                      Communication {review.communicationFluency} · Attentiveness{' '}
                      {review.attentiveness} · Bias signal {review.biasSignal}
                    </p>
                  </li>
                ))}
              </ul>
            )))
          }
        </section>
      )}
    </PageContainer>
  );
}
