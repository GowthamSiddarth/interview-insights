'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, Company } from '@/lib/api';
import {
  createDraft,
  deleteDraft,
  listDrafts,
  saveDraft,
  ProcessDraft,
} from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GatedSection } from '@/components/GatedSection';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';
const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

export default function HomePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  // null = still checking; false = no session. Only gates the *create a
  // new company* form below (GitHub issue #217) — picking an existing
  // company, and every bit of draft editing, needs no session at all.
  // A draft is pure client-side state (issue #253) until issue #255's
  // bulk submit, which is the only step that actually requires login.
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<ProcessDraft[]>([]);
  const [activeDraft, setActiveDraft] = useState<ProcessDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    setDrafts(listDrafts());
  }, []);

  function handleStartDraft(company: Company) {
    const draft = createDraft(company);
    setDrafts(listDrafts());
    setActiveDraft(draft);
  }

  async function handleCreateCompany(formData: FormData) {
    setError(null);
    try {
      const created = await api.createCompany({
        name: String(formData.get('name')),
        slug: String(formData.get('slug')),
        sizeBucket: formData.get('sizeBucket') as Company['sizeBucket'],
      });
      setCompanies((prev) => [created, ...prev]);
      handleStartDraft(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleBackToDrafts() {
    setActiveDraft(null);
  }

  function handleDeleteDraft(id: string) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    deleteDraft(id);
    setDrafts(listDrafts());
    if (activeDraft?.id === id) setActiveDraft(null);
  }

  function updateProcessField<K extends keyof ProcessDraft['process']>(
    key: K,
    value: ProcessDraft['process'][K],
  ) {
    if (!activeDraft) return;
    const updated = saveDraft({
      ...activeDraft,
      process: { ...activeDraft.process, [key]: value },
    });
    setActiveDraft(updated);
    setDrafts(listDrafts());
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Interview Insights</h1>
        <p className="text-sm text-gray-500">
          Rate your interview experience, round by round, and see how a
          company&apos;s process compares.
        </p>
      </header>

      <ErrorBanner message={error} />

      {!activeDraft && (
        <>
          {drafts.length > 0 && (
            <Card as="section" className="flex flex-col gap-3">
              <h2 className="font-medium">Your drafts</h2>
              <ul className="flex flex-col gap-2">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {d.companyName} — {d.process.roleTitle || 'Untitled process'}
                    </span>
                    <span className="flex gap-2">
                      <Button type="button" onClick={() => setActiveDraft(d)}>
                        Resume
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => handleDeleteDraft(d.id)}
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card as="section" className="flex flex-col gap-3">
            <h2 className="font-medium">Start a new draft</h2>
            {companies.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleStartDraft(c)}
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-500">Don&apos;t see the company you interviewed with?</p>
            <GatedSection
              loggedIn={candidateSession}
              prompt="Log in to add a company that isn't listed yet."
            >
              <form
                action={handleCreateCompany}
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
        </>
      )}

      {activeDraft && (
        <Card as="section" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{activeDraft.companyName}</h2>
            <span className="flex flex-wrap gap-3 text-sm">
              <Link href={`/companies/${activeDraft.companySlug}`} className={linkClass}>
                View company profile
              </Link>
              <button type="button" onClick={handleBackToDrafts} className={linkClass}>
                Back to my drafts
              </button>
              <button
                type="button"
                onClick={() => handleDeleteDraft(activeDraft.id)}
                className={linkClass}
              >
                Delete this draft
              </button>
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-col text-sm">
              Role title
              <input
                value={activeDraft.process.roleTitle}
                onChange={(e) => updateProcessField('roleTitle', e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col text-sm">
              Outcome
              <select
                value={activeDraft.process.outcome}
                onChange={(e) =>
                  updateProcessField('outcome', e.target.value as ProcessDraft['process']['outcome'])
                }
                className={inputClass}
              >
                <option value="in_progress">In progress</option>
                <option value="offer">Offer</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="ghosted">Ghosted</option>
              </select>
            </label>
          </div>

          {/* Rounds, recruiter touchpoints, and the overall review — plus
              final submission — land in the next update (GitHub issues
              #254/#255). This draft already survives a reload and can sit
              alongside drafts for other companies in the meantime. */}
          <p className="text-sm text-gray-500 italic">
            Add your first round or recruiter touchpoint once step navigation lands.
          </p>
        </Card>
      )}
    </PageContainer>
  );
}
