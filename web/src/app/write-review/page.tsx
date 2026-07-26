'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, CreateBulkProcessInput, RoundTypeFieldOptions, Round } from '@/lib/api';
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
  collectDraftReminders,
  validateDraft,
  DraftOverallReview,
  ProcessDraft,
} from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';
import { ErrorBanner } from '@/components/ErrorBanner';
import { StepNavigator } from '../wizard/step-navigator';
import { RoundStepForm } from '../wizard/round-step-form';
import { RecruiterStepForm } from '../wizard/recruiter-step-form';
import { ReviewScreen } from '../wizard/review-screen';
import { AddRoundModal } from '../wizard/add-round-modal';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';
const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// GitHub issue #301 (Phase 28) — the candidate session cookie (and its
// hint) both expire a fixed 1h after login, no sliding extension. A
// candidate can easily spend longer than that filling out a multi-round
// draft, so checking the session hint only once at mount would leave the
// page believing it's still logged in long after the real session died.
// Re-checked on this interval instead — cheap (a synchronous
// document.cookie read, no network call).
const SESSION_CHECK_INTERVAL_MS = 30_000;

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

// GitHub issue #283 (Phase 28) — a fixed sequence "Next" button, additive
// to (not a replacement for) the step navigator's free-jump list. Computed
// live from the draft's current array order on every call, never a stale
// snapshot, so adding/removing/reordering steps is always reflected.
function getNextStepId(draft: ProcessDraft, currentStepId: string): string | null {
  const sequence = [
    'process',
    ...draft.rounds.map((s) => s.clientId),
    ...draft.recruiterInteractions.map((s) => s.clientId),
    'overall',
    'review',
  ];
  const index = sequence.indexOf(currentStepId);
  if (index === -1 || index === sequence.length - 1) return null;
  return sequence[index + 1];
}

// GitHub issue #306 (Phase 28) — "Next" opens the add-round modal instead
// of navigating directly whenever leaving the current step would leave
// round-adding territory for the first time: from Process Details before
// any round exists, or from the last existing round. Any other step
// (an earlier round, a recruiter step, overall review) still navigates
// straight to the next existing step, same as issue #283 built.
function shouldOfferAddRoundModal(draft: ProcessDraft, currentStepId: string): boolean {
  if (currentStepId === 'process') return draft.rounds.length === 0;
  const lastRound = draft.rounds[draft.rounds.length - 1];
  return lastRound?.clientId === currentStepId;
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

// The write-a-review wizard — always arrived at with a company or a
// specific draft already chosen upstream (a "Write a review" link on
// search results/a company profile, or "Resume" on /drafts), never its own
// picker. Wrapped in Suspense because useSearchParams() requires it
// (Next.js App Router).
function WizardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // null = still checking; false = no session. Only gates the *submit*
  // step (GitHub issue #217/#255) — picking an existing company, and
  // every bit of draft editing, needs no session at all.
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);
  // GitHub issue #301 — set once a poll (or a submit's own 401) observes
  // the session going from logged-in to logged-out, so the wizard can
  // warn about it specifically ("your session expired") rather than
  // just quietly re-gating the submit button. Cleared once logged back in.
  const [sessionExpiredWarning, setSessionExpiredWarning] = useState(false);
  const [activeDraft, setActiveDraft] = useState<ProcessDraft | null>(null);
  const [activeStepId, setActiveStepId] = useState<string>('process');
  const [fieldOptions, setFieldOptions] = useState<RoundTypeFieldOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<SubmissionSummary | null>(null);
  // GitHub issue #306 — the add-round modal Next opens instead of
  // navigating directly, at the round-adding boundary.
  const [showAddRoundModal, setShowAddRoundModal] = useState(false);
  // Set synchronously the moment this mount consumes a company/draftId
  // param, so the "nothing to do here" redirect below can't fire again
  // once the params are stripped from the URL right after — a ref, not
  // state, since it has to be correct before the next effect run, not
  // after a render round-trip.
  const consumedContextRef = useRef(false);

  useEffect(() => {
    function checkSession() {
      const hasSession = api.hasCandidateSessionHint();
      setCandidateSession((prev) => {
        if (prev === true && !hasSession) setSessionExpiredWarning(true);
        else if (hasSession) setSessionExpiredWarning(false);
        return hasSession;
      });
    }
    checkSession();
    const interval = setInterval(checkSession, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
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

  function handleStartDraft(company: { id: string; name: string; slug: string }) {
    const draft = createDraft(company);
    setActiveDraft(draft);
    setActiveStepId('process');
    setSubmitSuccess(null);
  }

  // A company or an exact draft chosen upstream arrives here via query
  // params — this page never has its own picker. `companyId` resumes any
  // existing draft for that company or starts a fresh one (from a "Write
  // a review" link); `draftId` resumes that exact draft (from /drafts'
  // "Resume" button). Neither present, and nothing already active in this
  // session, means there's nothing useful to do here — a stale bookmark,
  // typed URL, or browser back button — so redirect home rather than show
  // a placeholder.
  useEffect(() => {
    const draftId = searchParams.get('draftId');
    if (draftId) {
      consumedContextRef.current = true;
      const existing = listDrafts().find((d) => d.id === draftId);
      if (existing) {
        setActiveDraft(existing);
        setActiveStepId('process');
      }
      router.replace('/write-review');
      return;
    }

    const companyId = searchParams.get('companyId');
    const companySlug = searchParams.get('companySlug');
    const companyName = searchParams.get('companyName');
    if (companyId && companySlug && companyName) {
      consumedContextRef.current = true;
      const existing = listDrafts().find((d) => d.companyId === companyId);
      if (existing) {
        setActiveDraft(existing);
        setActiveStepId('process');
      } else {
        handleStartDraft({ id: companyId, slug: companySlug, name: companyName });
      }
      router.replace('/write-review');
      return;
    }

    if (!consumedContextRef.current) {
      router.replace('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per incoming query-param set, not on every render
  }, [searchParams]);

  function handleDeleteDraft(id: string) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    deleteDraft(id);
    if (activeDraft?.id === id) setActiveDraft(null);
  }

  function persist(updated: ProcessDraft) {
    const saved = saveDraft(updated);
    setActiveDraft(saved);
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
      setActiveDraft(null);
      setActiveStepId('process');
      setSubmitSuccess(summary);
    } catch (err) {
      // GitHub issue #301 — a 401 here always means the session expired
      // between the last poll and this click, never an invalid draft.
      // Correct the session state immediately (rather than waiting for
      // the next poll) and show the same clear message the proactive
      // warning uses, not the generic validation-error fallback.
      if (err instanceof ApiError && err.status === 401) {
        setCandidateSession(false);
        setSessionExpiredWarning(true);
        setError('Your session has expired. Log in again to submit — your draft hasn\'t been lost.');
      } else {
        setError(submitErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const validationIssues = activeDraft ? validateDraft(activeDraft) : [];
  const reminders = activeDraft ? collectDraftReminders(activeDraft) : [];
  const activeRoundStep = activeDraft?.rounds.find((r) => r.clientId === activeStepId);
  const activeRecruiterStep = activeDraft?.recruiterInteractions.find(
    (r) => r.clientId === activeStepId,
  );
  const nextStepId = activeDraft ? getNextStepId(activeDraft, activeStepId) : null;
  // 'at-least-one-round' is a whole-draft completeness rule, not a defect
  // of the process step's own fields — clicking Next from Process
  // Details with zero rounds is exactly how a candidate resolves it (the
  // add-round modal below), so it must never block Next itself.
  const currentStepIssues = validationIssues.filter(
    (issue) => issue.stepId === activeStepId && issue.id !== 'at-least-one-round',
  );

  // GitHub issue #306 — Next is blocked entirely (no navigation, no modal)
  // while the current step has a validation issue, same guarantee Submit
  // already has; otherwise either opens the add-round modal at the
  // round-adding boundary or navigates directly, same as issue #283.
  function handleNextClick() {
    if (!activeDraft) return;
    if (currentStepIssues.length > 0) {
      setError(currentStepIssues.map((issue) => issue.message).join(' '));
      return;
    }
    setError(null);
    if (shouldOfferAddRoundModal(activeDraft, activeStepId)) {
      setShowAddRoundModal(true);
      return;
    }
    if (nextStepId) setActiveStepId(nextStepId);
  }

  function handleAddRoundFromModal(roundType: Round['roundType']) {
    handleAddRound(roundType);
    setShowAddRoundModal(false);
  }

  return (
    <PageContainer size={activeDraft ? 'wide' : 'narrow'}>
      <header>
        <h1 className="text-2xl font-semibold">Write a review</h1>
        <p className="text-sm text-gray-500">
          Rate your interview experience, round by round, and see how a
          company&apos;s process compares.
        </p>
      </header>

      <ErrorBanner message={error} />

      {!activeDraft && submitSuccess && (
        <SubmissionSuccess summary={submitSuccess} onDone={() => router.push('/drafts')} />
      )}

      {activeDraft && (
        <Card as="section" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{activeDraft.companyName}</h2>
            <span className="flex flex-wrap gap-3 text-sm">
              <Link href={`/companies/${activeDraft.companySlug}`} className={linkClass}>
                View company profile
              </Link>
              <Link href="/drafts" className={linkClass}>
                Back to my drafts
              </Link>
              <button
                type="button"
                onClick={() => handleDeleteDraft(activeDraft.id)}
                className={linkClass}
              >
                Delete this draft
              </button>
            </span>
          </div>

          {sessionExpiredWarning && (
            <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
              Your session has expired.{' '}
              <Link href="/login" className="font-medium underline">
                Log in again
              </Link>{' '}
              before submitting — your draft is saved and won&apos;t be lost.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
            <StepNavigator
              draft={activeDraft}
              activeStepId={activeStepId}
              onSelect={setActiveStepId}
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
                  onChange={(interaction) =>
                    persist(
                      updateRecruiterStep(activeDraft, activeRecruiterStep.clientId, interaction),
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
                  reminders={reminders}
                  onEditStep={setActiveStepId}
                  onAddRecruiterStep={handleAddRecruiter}
                  onSubmit={handleSubmit}
                />
              )}

              {activeStepId !== 'review' && nextStepId && (
                <div className="mt-4">
                  <Button type="button" variant="neutral" onClick={handleNextClick}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {showAddRoundModal && (
        <AddRoundModal
          onAddRound={handleAddRoundFromModal}
          onFinishAndReview={() => {
            setShowAddRoundModal(false);
            setActiveStepId('review');
          }}
          onCancel={() => setShowAddRoundModal(false)}
        />
      )}
    </PageContainer>
  );
}

export default function WizardPage() {
  return (
    <Suspense fallback={null}>
      <WizardContent />
    </Suspense>
  );
}
