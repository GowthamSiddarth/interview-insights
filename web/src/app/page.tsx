'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, Company, CreateBulkProcessInput, RoundTypeFieldOptions, Round } from '@/lib/api';
import {
  addRecruiterStep,
  addRoundStep,
  createDraft,
  deleteDraft,
  listDrafts,
  removeRecruiterStep,
  removeRoundStep,
  saveDraft,
  setOverallReview,
  updateRecruiterStep,
  updateRoundStep,
  validateDraft,
  DraftOverallReview,
  ProcessDraft,
} from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';
import { ErrorBanner } from '@/components/ErrorBanner';
import { GatedSection } from '@/components/GatedSection';
import { StepNavigator } from './wizard/step-navigator';
import { RoundStepForm } from './wizard/round-step-form';
import { RecruiterStepForm } from './wizard/recruiter-step-form';
import { ReviewScreen } from './wizard/review-screen';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';
const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// GitHub issue #281 (Phase 28) — client-side pre-submit checks (see
// validateDraft()) catch the common cases before the bulk endpoint ever
// sees them, but this is the fallback for whatever validation error does
// still reach the UI: translate the bulk endpoint's known
// class-validator message shapes ("recruiterInteractions.0.recruiterIdentifier
// should not be empty") into plain English instead of showing the raw
// dotted path. Deliberately scoped to just the field/rule shapes this one
// endpoint can actually produce, not a generic class-validator translator.
const SUBMIT_FIELD_LABELS: Record<string, string> = {
  roleTitle: 'Role title',
  recruiterIdentifier: 'Recruiter name or email',
  title: 'Round title',
  overallExperience: 'Overall experience rating',
  difficulty: 'Difficulty rating',
  fluency: 'Fluency rating',
  clarity: 'Clarity rating',
  focus: 'Focus rating',
  reachability: 'Reachability rating',
  responsiveness: 'Responsiveness rating',
  guidelinesShared: 'Guidelines-shared rating',
};

const SUBMIT_SECTION_LABELS: Record<string, (index: number) => string> = {
  rounds: (index) => `Round ${index}`,
  recruiterInteractions: (index) => `Recruiter touchpoint ${index}`,
};

function humanizeSubmitValidationMessage(raw: string): string {
  const nested = raw.match(/^(\w+)\.(\d+)\.(\w+) (should not be empty|must .+)$/);
  if (nested) {
    const [, section, indexStr, field, rule] = nested;
    const sectionLabel = SUBMIT_SECTION_LABELS[section]?.(Number(indexStr) + 1) ?? section;
    const fieldLabel = SUBMIT_FIELD_LABELS[field] ?? field;
    return `${sectionLabel}: ${fieldLabel} ${rule === 'should not be empty' ? 'is required.' : `${rule}.`}`;
  }
  const flat = raw.match(/^(\w+) (should not be empty|must .+)$/);
  if (flat) {
    const [, field, rule] = flat;
    const fieldLabel = SUBMIT_FIELD_LABELS[field] ?? field;
    return `${fieldLabel} ${rule === 'should not be empty' ? 'is required.' : `${rule}.`}`;
  }
  return 'Please check the highlighted fields and try again.';
}

function submitErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.messages.map(humanizeSubmitValidationMessage).join(' ');
  }
  return 'Something went wrong.';
}

function OverallReviewForm({
  value,
  onChange,
}: {
  value: DraftOverallReview | undefined;
  onChange: (value: DraftOverallReview | undefined) => void;
}) {
  function toggle(hasReview: boolean) {
    onChange(hasReview ? { overallExperience: 3, wouldRecommend: false } : undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Overall review</h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value} onChange={(e) => toggle(e.target.checked)} />
        I have an overall review for this process
      </label>
      {value && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col text-sm">
              Overall experience (1–5)
              <input
                type="number"
                min={1}
                max={5}
                value={value.overallExperience}
                onChange={(e) => onChange({ ...value, overallExperience: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.wouldRecommend}
                onChange={(e) => onChange({ ...value, wouldRecommend: e.target.checked })}
              />
              I&apos;d recommend interviewing here
            </label>
          </div>
          <label className="flex flex-col text-sm">
            Summary of the whole process (optional)
            <textarea
              rows={2}
              value={value.reviewText ?? ''}
              onChange={(e) => onChange({ ...value, reviewText: e.target.value || undefined })}
              className={inputClass}
            />
          </label>
        </>
      )}
    </div>
  );
}

interface SubmissionSummary {
  companyName: string;
  roundRatings: number;
  recruiterRatings: number;
  hasOverallReview: boolean;
}

function SubmissionSuccess({
  summary,
  onDone,
}: {
  summary: SubmissionSummary;
  onDone: () => void;
}) {
  const parts: string[] = [];
  if (summary.roundRatings > 0) {
    parts.push(`${summary.roundRatings} round rating${summary.roundRatings === 1 ? '' : 's'}`);
  }
  if (summary.recruiterRatings > 0) {
    parts.push(
      `${summary.recruiterRatings} recruiter rating${summary.recruiterRatings === 1 ? '' : 's'}`,
    );
  }
  if (summary.hasOverallReview) parts.push('an overall review');

  return (
    <Card as="section" className="flex flex-col gap-3">
      <h2 className="font-medium text-green-700 dark:text-green-400">Submitted!</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Your process at {summary.companyName} has been created.
        {parts.length > 0 && (
          <>
            {' '}
            {parts.join(', ')} {parts.length === 1 ? 'is' : 'are'} pending moderation before
            becoming public — same as every other rating on this platform.
          </>
        )}
      </p>
      <Button type="button" onClick={onDone}>
        Back to my drafts
      </Button>
    </Card>
  );
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
  const [activeStepId, setActiveStepId] = useState<string>('process');
  const [fieldOptions, setFieldOptions] = useState<RoundTypeFieldOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<SubmissionSummary | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    setDrafts(listDrafts());
  }, []);

  // Fetched once — the round-type registry (GitHub issue #248) drives the
  // "add round" menu and every round step's type_metadata fields, so
  // there's nothing to hardcode here as new round types/fields are added
  // server-side.
  useEffect(() => {
    api
      .getRoundTypeFieldOptions()
      .then(setFieldOptions)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  function handleStartDraft(company: Company) {
    const draft = createDraft(company);
    setDrafts(listDrafts());
    setActiveDraft(draft);
    setActiveStepId('process');
    setSubmitSuccess(null);
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

  function persist(updated: ProcessDraft) {
    const saved = saveDraft(updated);
    setActiveDraft(saved);
    setDrafts(listDrafts());
    return saved;
  }

  function updateProcessField<K extends keyof ProcessDraft['process']>(
    key: K,
    value: ProcessDraft['process'][K],
  ) {
    if (!activeDraft) return;
    persist({ ...activeDraft, process: { ...activeDraft.process, [key]: value } });
  }

  function handleAddRound(roundType: Round['roundType']) {
    if (!activeDraft) return;
    const nextSequenceNumber = activeDraft.rounds.length + 1;
    const saved = persist(
      addRoundStep(activeDraft, {
        sequenceNumber: nextSequenceNumber,
        title: '',
        roundType,
        // GitHub issue #282 (Phase 28) — a rating is available by default
        // for every round, not an opt-in click per round; still removable
        // via the round form's own checkbox.
        rating: { difficulty: 3, fluency: 3, clarity: 3, focus: 3 },
      }),
    );
    setActiveStepId(saved.rounds[saved.rounds.length - 1].clientId);
  }

  function handleAddRecruiter(timing: 'start' | 'end') {
    if (!activeDraft) return;
    const saved = persist(addRecruiterStep(activeDraft, { recruiterIdentifier: '' }, timing));
    setActiveStepId(saved.recruiterInteractions[saved.recruiterInteractions.length - 1].clientId);
  }

  function handleRemoveRound(clientId: string) {
    if (!activeDraft) return;
    persist(removeRoundStep(activeDraft, clientId));
    setActiveStepId('process');
  }

  function handleRemoveRecruiter(clientId: string) {
    if (!activeDraft) return;
    persist(removeRecruiterStep(activeDraft, clientId));
    setActiveStepId('process');
  }

  // GitHub issue #255 — the only network call this whole draft flow ever
  // makes before this point. Because the bulk endpoint is fully atomic
  // (D49), any failure here leaves the draft completely untouched, so the
  // candidate can just fix whatever's wrong and try again — no partial
  // state to reconcile.
  async function handleSubmit() {
    if (!activeDraft) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateBulkProcessInput = {
        ...activeDraft.process,
        rounds: activeDraft.rounds.length > 0 ? activeDraft.rounds.map((s) => s.round) : undefined,
        recruiterInteractions:
          activeDraft.recruiterInteractions.length > 0
            ? activeDraft.recruiterInteractions.map((s) => s.interaction)
            : undefined,
        overallReview: activeDraft.overallReview,
      };
      await api.createBulkProcess(activeDraft.companyId, payload);

      const summary: SubmissionSummary = {
        companyName: activeDraft.companyName,
        roundRatings: activeDraft.rounds.filter((s) => s.round.rating).length,
        recruiterRatings: activeDraft.recruiterInteractions.filter((s) => s.interaction.rating)
          .length,
        hasOverallReview: !!activeDraft.overallReview,
      };
      deleteDraft(activeDraft.id);
      setDrafts(listDrafts());
      setActiveDraft(null);
      setActiveStepId('process');
      setSubmitSuccess(summary);
    } catch (err) {
      setError(submitErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const validationIssues = activeDraft ? validateDraft(activeDraft) : [];
  const activeRoundStep = activeDraft?.rounds.find((r) => r.clientId === activeStepId);
  const activeRecruiterStep = activeDraft?.recruiterInteractions.find(
    (r) => r.clientId === activeStepId,
  );

  return (
    <PageContainer size={activeDraft ? 'wide' : 'narrow'}>
      <header>
        <h1 className="text-2xl font-semibold">Interview Insights</h1>
        <p className="text-sm text-gray-500">
          Rate your interview experience, round by round, and see how a
          company&apos;s process compares.
        </p>
      </header>

      <ErrorBanner message={error} />

      {!activeDraft && submitSuccess && (
        <SubmissionSuccess summary={submitSuccess} onDone={() => setSubmitSuccess(null)} />
      )}

      {!activeDraft && !submitSuccess && (
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
                      <Button
                        type="button"
                        onClick={() => {
                          setActiveDraft(d);
                          setActiveStepId('process');
                        }}
                      >
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
            <StepNavigator
              draft={activeDraft}
              activeStepId={activeStepId}
              onSelect={setActiveStepId}
              onAddRound={handleAddRound}
              onAddRecruiter={handleAddRecruiter}
            />

            <div className="border-t border-gray-200 pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4 dark:border-gray-700">
              {activeStepId === 'process' && (
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
                        updateProcessField(
                          'outcome',
                          e.target.value as ProcessDraft['process']['outcome'],
                        )
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
              )}

              {activeRoundStep && (
                <RoundStepForm
                  step={activeRoundStep}
                  fieldOptions={fieldOptions}
                  onChange={(round) => persist(updateRoundStep(activeDraft, activeRoundStep.clientId, round))}
                  onRemove={() => handleRemoveRound(activeRoundStep.clientId)}
                />
              )}

              {activeRecruiterStep && (
                <RecruiterStepForm
                  step={activeRecruiterStep}
                  onChange={(interaction, timing) =>
                    persist(
                      updateRecruiterStep(
                        activeDraft,
                        activeRecruiterStep.clientId,
                        interaction,
                        timing,
                      ),
                    )
                  }
                  onRemove={() => handleRemoveRecruiter(activeRecruiterStep.clientId)}
                />
              )}

              {activeStepId === 'overall' && (
                <OverallReviewForm
                  value={activeDraft.overallReview}
                  onChange={(overallReview) =>
                    persist(setOverallReview(activeDraft, overallReview))
                  }
                />
              )}

              {activeStepId === 'review' && (
                <ReviewScreen
                  draft={activeDraft}
                  loggedIn={candidateSession}
                  submitting={submitting}
                  validationIssues={validationIssues}
                  onEditStep={setActiveStepId}
                  onSubmit={handleSubmit}
                />
              )}
            </div>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
