'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, Company, InterviewProcess, Round, RoundRating } from '@/lib/api';

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

export default function HomePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [process, setProcess] = useState<InterviewProcess | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [rating, setRating] = useState<RoundRating | null>(null);
  const [approvedRatings, setApprovedRatings] = useState<RoundRating[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  async function handleCreateCompany(formData: FormData) {
    setError(null);
    try {
      const created = await api.createCompany({
        name: String(formData.get('name')),
        slug: String(formData.get('slug')),
        sizeBucket: formData.get('sizeBucket') as Company['sizeBucket'],
      });
      setCompanies((prev) => [created, ...prev]);
      setCompany(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateProcess(formData: FormData) {
    if (!company) return;
    setError(null);
    try {
      const candidate = await api.createCandidate(String(formData.get('email')));
      setCandidateId(candidate.id);
      const created = await api.createProcess(company.id, {
        candidateId: candidate.id,
        roleTitle: String(formData.get('roleTitle')),
        outcome: formData.get('outcome') as InterviewProcess['outcome'],
      });
      setProcess(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateRound(formData: FormData) {
    if (!process) return;
    setError(null);
    try {
      const created = await api.createRound(process.id, {
        sequenceNumber: (process.rounds?.length ?? 0) + 1,
        title: String(formData.get('title')),
        roundType: formData.get('roundType') as Round['roundType'],
      });
      setRound(created);
      setProcess({ ...process, rounds: [...(process.rounds ?? []), created] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateRating(formData: FormData) {
    if (!round || !candidateId) return;
    setError(null);
    const field = (name: string) => Number(formData.get(name));
    try {
      const created = await api.createRoundRating(round.id, {
        candidateId,
        difficulty: field('difficulty'),
        fairness: field('fairness'),
        communicationFluency: field('communicationFluency'),
        attentiveness: field('attentiveness'),
        biasSignal: field('biasSignal'),
      });
      setRating(created);
      const approved = await api.listApprovedRatingsForRound(round.id);
      setApprovedRatings(approved);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Interview Insights</h1>
        <p className="text-sm text-gray-500">
          Phase 2 vertical slice: Company → InterviewProcess → Round → RoundRating.
        </p>
      </header>

      <ErrorBanner message={error} />

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">1. Company</h2>
        {companies.length > 0 && !company && (
          <div className="flex flex-wrap gap-2">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => setCompany(c)}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        {!company && (
          <form
            action={handleCreateCompany}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <label className="flex flex-col text-sm">
              Name
              <input name="name" required className="rounded border px-2 py-1 dark:bg-gray-900" />
            </label>
            <label className="flex flex-col text-sm">
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="acme-corp"
                className="rounded border px-2 py-1 dark:bg-gray-900"
              />
            </label>
            <label className="flex flex-col text-sm">
              Size
              <select name="sizeBucket" className="rounded border px-2 py-1 dark:bg-gray-900">
                <option value="startup">Startup</option>
                <option value="mid">Mid</option>
                <option value="large">Large</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
            >
              Create company
            </button>
          </form>
        )}
        {company && <p className="text-sm text-green-700 dark:text-green-400">Using {company.name}.</p>}
      </section>

      {company && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">2. Candidate + interview process</h2>
          {!process && (
            <form
              action={handleCreateProcess}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <label className="flex flex-col text-sm">
                Candidate email
                <input
                  name="email"
                  type="email"
                  required
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
              </label>
              <label className="flex flex-col text-sm">
                Role title
                <input
                  name="roleTitle"
                  required
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
              </label>
              <label className="flex flex-col text-sm">
                Outcome
                <select name="outcome" className="rounded border px-2 py-1 dark:bg-gray-900">
                  <option value="in_progress">In progress</option>
                  <option value="offer">Offer</option>
                  <option value="rejected">Rejected</option>
                  <option value="withdrawn">Withdrawn</option>
                  <option value="ghosted">Ghosted</option>
                </select>
              </label>
              <button
                type="submit"
                className="rounded bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
              >
                Create process
              </button>
            </form>
          )}
          {process && (
            <p className="text-sm text-green-700 dark:text-green-400">
              Process created for &quot;{process.roleTitle}&quot;.
            </p>
          )}
        </section>
      )}

      {process && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">3. Round</h2>
          {!round && (
            <form
              action={handleCreateRound}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <label className="flex flex-col text-sm">
                Title
                <input
                  name="title"
                  required
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
              </label>
              <label className="flex flex-col text-sm">
                Type
                <select name="roundType" className="rounded border px-2 py-1 dark:bg-gray-900">
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
              <button
                type="submit"
                className="rounded bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
              >
                Add round
              </button>
            </form>
          )}
          {round && (
            <p className="text-sm text-green-700 dark:text-green-400">
              Round &quot;{round.title}&quot; added.
            </p>
          )}
        </section>
      )}

      {round && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">4. Rating</h2>
          {!rating && (
            <form action={handleCreateRating} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(['difficulty', 'fairness', 'communicationFluency', 'attentiveness', 'biasSignal'] as const).map(
                (field) => (
                  <label key={field} className="flex flex-col text-sm capitalize">
                    {field.replace(/([A-Z])/g, ' $1')}
                    <input
                      name={field}
                      type="number"
                      min={1}
                      max={5}
                      required
                      defaultValue={3}
                      className="rounded border px-2 py-1 dark:bg-gray-900"
                    />
                  </label>
                ),
              )}
              <button
                type="submit"
                className="col-span-full rounded bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
              >
                Submit rating
              </button>
            </form>
          )}
          {rating && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-green-700 dark:text-green-400">
                Rating submitted — status: <strong>{rating.status}</strong>.
              </p>
              <p className="text-gray-500">
                Every rating starts <code>pending</code> and stays invisible to the public until a
                moderator approves it (docs/DECISIONS.md D3). The public ratings list below is
                expected to be empty until Phase 3&apos;s moderation worker exists.
              </p>
              <p>
                Public approved ratings for this round:{' '}
                <strong>{approvedRatings?.length ?? 0}</strong>
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
