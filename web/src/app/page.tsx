'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, ApiError, Company, CompanySearchResult } from '@/lib/api';
import { CompanyCard } from '@/components/CompanyCard';
import { CompanyResultRow } from '@/components/CompanyResultRow';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { GatedSection } from '@/components/GatedSection';
import { PageContainer } from '@/components/PageContainer';

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// Landing page — finding a company is the only job here; viewing its
// profile, browsing/filtering its reviews, and writing a new one all live
// on the company's own pages now (GitHub issue #423, Phase 38 — this page
// used to also render an inline "browse reviews" panel for whichever
// company you picked, but that duplicated what the profile page does and
// is gone).
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
  const [error, setError] = useState<string | null>(null);
  // GitHub issue #360 (Phase 34) — the create-company-request section is
  // deliberately reachable only from a failed search's own button, never
  // from page load or a nav link (see this state's one setter below).
  const [showCreateCompanyRequest, setShowCreateCompanyRequest] = useState(false);
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);
  // GitHub issue #372 (Phase 35) — a successful creation no longer means
  // "ready to use" now that company creation is moderation-gated (issue
  // #369); this replaces the old auto-redirect into /write-review with a
  // plain acknowledgment.
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  // GitHub issue #415 — quick-select buttons, one per company, the same
  // shape the wizard's old company picker used, relocated here now that
  // discovery is this page's job. Capped to 5 (topCompanies(), random
  // for now — issue #366 flagged the uncapped list as unusable once it
  // grew past a screenful), not the full listCompanies().
  useEffect(() => {
    api.topCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
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
    setShowCreateCompanyRequest(false);
    try {
      setCompanyResults(await api.searchCompanies(q));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCompanySearching(false);
    }
  }

  // Reuses the wizard's former create-company form (moved here, not
  // duplicated, per issue #358/#360). GitHub issue #372: a successful
  // creation just confirms the request was submitted — it doesn't
  // navigate anywhere, since the new company is pending review, not
  // usable yet (issue #369).
  async function handleCreateCompanyRequest(formData: FormData) {
    setError(null);
    try {
      await api.createCompany({
        name: String(formData.get('name')),
        slug: String(formData.get('slug')),
        sizeBucket: formData.get('sizeBucket') as Company['sizeBucket'],
      });
      setConfirmationMessage('A create company request has been submitted.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Collapses the request section back to just its trigger button once
  // the confirmation is dismissed, restoring the page's pre-request state.
  function handleCloseConfirmation() {
    setConfirmationMessage(null);
    setShowCreateCompanyRequest(false);
  }

  return (
    <PageContainer size="wide">
      {/* Hero (GitHub issue #617) — same copy/heading text as before
          (tests assert "Interview Insights" is present), restyled as
          the page's opening thesis rather than a plain h1/p pair.
          Keeps Phase 33's search-first information architecture —
          this is a visual pass, not another product pivot. */}
      <header className="flex flex-col items-center gap-3 py-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Interview Insights</h1>
        <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
          Find a company to view its profile, browse its approved reviews, or write one.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Card as="section" className="flex flex-col gap-4">
        <h2 className="font-medium">Find a company</h2>
        <form onSubmit={handleCompanySearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            />
            <input
              name="q"
              required
              placeholder="Company name"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-9 pr-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        {companies.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-500">Or pick one directly:</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {companies.map((c) => (
                <CompanyCard key={c.id} company={c} />
              ))}
            </div>
          </div>
        )}

        {companySearching ? (
          <p className="text-sm text-gray-500">Searching…</p>
        ) : (
          companyResults !== null &&
          (companyResults.length === 0 ? (
            <div className="flex flex-col gap-2">
              <EmptyState message={`No companies match "${companyQuery}".`} />
              {!showCreateCompanyRequest && (
                <Button
                  type="button"
                  variant="neutral"
                  className="self-start"
                  onClick={() => setShowCreateCompanyRequest(true)}
                >
                  Want to file a create company request?
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {companyResults.map((company) => (
                <CompanyResultRow key={company.id} company={company} />
              ))}
            </ul>
          )))
        }
      </Card>

      {showCreateCompanyRequest && (
        <Card as="section" className="flex flex-col gap-3">
          <h2 className="font-medium">Request a new company</h2>
          <p className="text-sm text-gray-500">
            Your search didn&apos;t find &quot;{companyQuery}&quot; — add it below so you can write
            a review for it. This creates the company itself, not a review.
          </p>
          <GatedSection
            loggedIn={candidateSession}
            prompt="Log in to request a new company."
          >
            <form
              action={handleCreateCompanyRequest}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <label className="flex flex-col text-sm">
                Name
                <input name="name" required className={inputClass} />
              </label>
              <label className="flex flex-col text-sm">
                Slug
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="acme-corp"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col text-sm">
                Size
                <select name="sizeBucket" className={inputClass}>
                  <option value="startup">Startup</option>
                  <option value="mid">Mid</option>
                  <option value="large">Large</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
              <Button type="submit">Create company</Button>
            </form>
          </GatedSection>
        </Card>
      )}

      {confirmationMessage && (
        <ConfirmationModal
          title="Request submitted"
          message={confirmationMessage}
          onClose={handleCloseConfirmation}
        />
      )}
    </PageContainer>
  );
}
