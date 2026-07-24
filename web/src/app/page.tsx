'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  Company,
  InterviewProcess,
  OverallReview,
  RecruiterRating,
  Round,
  RoundRating,
} from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

const linkClass =
  'text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

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
  // null = still checking; false = no session — GitHub issue #147 gates
  // step 2 on a real candidate session instead of collecting an email
  // inline, now that candidate creation only happens via the magic-link
  // auth flow (issue #145/#146). Also gates step 1's *create* form (not
  // the existing-company picker, which is just a read) now that
  // POST /companies requires a session too. Read from the session-hint
  // cookie (see NavBar/api.ts) rather than a GET /auth/me call — no
  // network 401 to log purely for rendering this gate on the platform's
  // home page.
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);
  const [process, setProcess] = useState<InterviewProcess | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [rating, setRating] = useState<RoundRating | null>(null);
  const [approvedRatings, setApprovedRatings] = useState<RoundRating[] | null>(null);
  const [recruiterRating, setRecruiterRating] = useState<RecruiterRating | null>(null);
  const [overallReview, setOverallReview] = useState<OverallReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  function handleChangeCompany() {
    // Reset every step that depended on the previous company — none of
    // it applies once a different company is selected.
    setCompany(null);
    setProcess(null);
    setRound(null);
    setRating(null);
    setApprovedRatings(null);
    setRecruiterRating(null);
    setOverallReview(null);
    setError(null);
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
      setCompany(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateProcess(formData: FormData) {
    if (!company || !candidateSession) return;
    setError(null);
    try {
      const created = await api.createProcess(company.id, {
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
    if (!round) return;
    setError(null);
    const field = (name: string) => Number(formData.get(name));
    try {
      const created = await api.createRoundRating(round.id, {
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

  async function handleCreateRecruiterRating(formData: FormData) {
    if (!process) return;
    setError(null);
    const field = (name: string) => Number(formData.get(name));
    try {
      // Two writes in sequence: the interaction resolves the recruiter's
      // internal identity server-side (the identifier is hashed, never
      // stored raw), then the rating attaches to that interaction.
      const interaction = await api.createRecruiterInteraction(process.id, {
        recruiterIdentifier: String(formData.get('recruiterIdentifier')),
      });
      const freeText = String(formData.get('freeText') ?? '').trim();
      const created = await api.createRecruiterRating(interaction.id, {
        approachability: field('approachability'),
        responseTime: field('responseTime'),
        timeliness: field('timeliness'),
        communicationQuality: field('communicationQuality'),
        ...(freeText ? { freeText } : {}),
      });
      setRecruiterRating(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateOverallReview(formData: FormData) {
    if (!process) return;
    setError(null);
    try {
      const reviewText = String(formData.get('reviewText') ?? '').trim();
      const created = await api.createOverallReview(process.id, {
        overallExperience: Number(formData.get('overallExperience')),
        wouldRecommend: formData.get('wouldRecommend') === 'on',
        ...(reviewText ? { reviewText } : {}),
      });
      setOverallReview(created);
    } catch (err) {
      setError(errorMessage(err));
    }
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
        {/* Selecting an existing company (above) is just a read/UI action —
            no session needed. Creating a *new* one is a write, gated on a
            real session same as every other write path (POST /companies
            now requires CandidateJwtAuthGuard). */}
        {!company && candidateSession === false && (
          <p className="text-sm text-gray-500">
            <Link href="/login" className={linkClass}>
              Log in
            </Link>{' '}
            to add a company that isn&apos;t listed yet.
          </p>
        )}
        {!company && candidateSession && (
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
            <Button type="submit">Create company</Button>
          </form>
        )}
        {company && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Using {company.name}.{' '}
            <Link href={`/companies/${company.slug}`} className={linkClass}>
              View company profile
            </Link>{' '}
            ·{' '}
            <Link href={`/companies/${company.slug}/analytics`} className={linkClass}>
              View analytics dashboard
            </Link>{' '}
            ·{' '}
            <button type="button" onClick={handleChangeCompany} className={linkClass}>
              Change company
            </button>
          </p>
        )}
      </section>

      {company && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">2. Interview process</h2>
          {candidateSession === null && (
            <p className="text-sm text-gray-500">Checking your session…</p>
          )}
          {candidateSession === false && (
            <p className="text-sm text-gray-500">
              <Link href="/login" className={linkClass}>
                Log in
              </Link>{' '}
              to submit a review — no password, just a login link emailed to you.
            </p>
          )}
          {candidateSession && !process && (
            <form
              action={handleCreateProcess}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
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
              <Button type="submit">Create process</Button>
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
              <Button type="submit">Add round</Button>
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
              <Button type="submit" className="col-span-full">
                Submit rating
              </Button>
            </form>
          )}
          {rating && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-green-700 dark:text-green-400">
                Rating submitted — status: <strong>{rating.status}</strong>.
              </p>
              {/* Every rating is moderated before it's public (docs/DECISIONS.md D3) —
                  a pending rating won't count below until it's approved. */}
              <p className="text-gray-500">
                Thanks for sharing your experience. Every rating is reviewed before it
                becomes public, so yours may not appear in the count below right away.
              </p>
              <p>
                Public approved ratings for this round:{' '}
                {/* null means still fetching, not "confirmed zero" — GitHub
                    issue #61 found these looked identical (both rendered
                    "0"), verified live against a deliberately delayed
                    response. */}
                <strong>{approvedRatings === null ? '…' : approvedRatings.length}</strong>
              </p>
            </div>
          )}
        </section>
      )}

      {round && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">5. Recruiter experience</h2>
          {!recruiterRating && (
            <form action={handleCreateRecruiterRating} className="flex flex-col gap-2">
              <label className="flex flex-col text-sm">
                Recruiter name or email
                <input
                  name="recruiterIdentifier"
                  required
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
                <span className="text-xs text-gray-500">
                  Used only to tell recruiters apart — never shown publicly.
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['approachability', 'responseTime', 'timeliness', 'communicationQuality'] as const).map(
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
              </div>
              <label className="flex flex-col text-sm">
                Anything else about the recruiter experience? (optional)
                <textarea
                  name="freeText"
                  rows={2}
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
              </label>
              <Button type="submit" className="self-start">
                Submit recruiter rating
              </Button>
            </form>
          )}
          {recruiterRating && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-green-700 dark:text-green-400">
                Recruiter rating submitted — status: <strong>{recruiterRating.status}</strong>.
              </p>
              <p className="text-gray-500">
                Like round ratings, recruiter ratings are reviewed before they become
                public.
              </p>
            </div>
          )}
        </section>
      )}

      {round && (
        <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="font-medium">6. Overall review</h2>
          {!overallReview && (
            <form action={handleCreateOverallReview} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col text-sm">
                  Overall experience (1–5)
                  <input
                    name="overallExperience"
                    type="number"
                    min={1}
                    max={5}
                    required
                    defaultValue={3}
                    className="rounded border px-2 py-1 dark:bg-gray-900"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input name="wouldRecommend" type="checkbox" />
                  I&apos;d recommend interviewing here
                </label>
              </div>
              <label className="flex flex-col text-sm">
                Summary of the whole process (optional)
                <textarea
                  name="reviewText"
                  rows={2}
                  className="rounded border px-2 py-1 dark:bg-gray-900"
                />
              </label>
              {/* One overall review per process (schema-enforced) — the form
                  disappears after submission, and a duplicate attempt from a
                  stale tab surfaces the API's 409 in the error banner. */}
              <Button type="submit" className="self-start">
                Submit overall review
              </Button>
            </form>
          )}
          {overallReview && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-green-700 dark:text-green-400">
                Overall review submitted — status: <strong>{overallReview.status}</strong>.
              </p>
              <p className="text-gray-500">
                Reviewed before it becomes public, same as your ratings. That&apos;s the
                whole flow — thanks for sharing your experience.
              </p>
            </div>
          )}
        </section>
      )}
    </PageContainer>
  );
}
