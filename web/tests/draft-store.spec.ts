import {
  addRoundStep,
  addRecruiterStep,
  createDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  removeRoundStep,
  saveDraft,
  setOverallReview,
  validateDraft,
} from '../src/lib/draft-store';

const acme = { id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' };
const globex = { id: 'company-2', name: 'Globex', slug: 'globex' };

describe('draft-store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates a draft scoped to one company, with empty rounds/recruiterInteractions', () => {
    const draft = createDraft(acme);

    expect(draft.companyId).toBe('company-1');
    expect(draft.companyName).toBe('Acme Corp');
    expect(draft.rounds).toEqual([]);
    expect(draft.recruiterInteractions).toEqual([]);
    expect(draft.overallReview).toBeUndefined();
  });

  it('persists across a simulated reload (re-reading localStorage fresh)', () => {
    const draft = createDraft(acme);
    saveDraft({ ...draft, process: { ...draft.process, roleTitle: 'Senior Engineer' } });

    // Simulate a reload: nothing but localStorage survives, no in-memory
    // reference reused.
    const reloaded = getDraft(draft.id);

    expect(reloaded).toBeDefined();
    expect(reloaded?.process.roleTitle).toBe('Senior Engineer');
  });

  it('supports two simultaneous drafts across different companies without corrupting each other', () => {
    const draftA = createDraft(acme);
    const draftB = createDraft(globex);

    saveDraft({ ...draftA, process: { ...draftA.process, roleTitle: 'Backend Engineer' } });
    saveDraft({ ...draftB, process: { ...draftB.process, roleTitle: 'Product Manager' } });

    const reloadedA = getDraft(draftA.id);
    const reloadedB = getDraft(draftB.id);

    expect(reloadedA?.process.roleTitle).toBe('Backend Engineer');
    expect(reloadedA?.companyId).toBe('company-1');
    expect(reloadedB?.process.roleTitle).toBe('Product Manager');
    expect(reloadedB?.companyId).toBe('company-2');

    const all = listDrafts();
    expect(all).toHaveLength(2);
  });

  it('lists drafts most-recently-updated first', () => {
    // saveDraft always bumps updatedAt to the real current time (an
    // injected value would just be overwritten), so real ordering needs
    // a controlled clock rather than hand-picked timestamps.
    jest.useFakeTimers().setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const draftA = createDraft(acme);

    jest.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const draftB = createDraft(globex);

    jest.setSystemTime(new Date('2020-06-01T00:00:00.000Z'));
    saveDraft(draftA);

    const all = listDrafts();
    expect(all[0].id).toBe(draftB.id);

    jest.useRealTimers();
  });

  it('deletes a draft', () => {
    const draft = createDraft(acme);
    deleteDraft(draft.id);

    expect(getDraft(draft.id)).toBeUndefined();
    expect(listDrafts()).toHaveLength(0);
  });

  it('addRoundStep appends a round with its own clientId, independent of other rounds', () => {
    let draft = createDraft(acme);
    draft = addRoundStep(draft, { sequenceNumber: 1, title: 'Screen', roundType: 'coding' });
    draft = addRoundStep(draft, { sequenceNumber: 2, title: 'Onsite', roundType: 'system_design' });

    expect(draft.rounds).toHaveLength(2);
    expect(draft.rounds[0].clientId).not.toBe(draft.rounds[1].clientId);
    expect(draft.rounds[0].round.roundType).toBe('coding');
    expect(draft.rounds[1].round.roundType).toBe('system_design');
  });

  it('removeRoundStep removes only the targeted step', () => {
    let draft = createDraft(acme);
    draft = addRoundStep(draft, { sequenceNumber: 1, title: 'Screen', roundType: 'coding' });
    draft = addRoundStep(draft, { sequenceNumber: 2, title: 'Onsite', roundType: 'coding' });
    const [first, second] = draft.rounds;

    draft = removeRoundStep(draft, first.clientId);

    expect(draft.rounds).toHaveLength(1);
    expect(draft.rounds[0].clientId).toBe(second.clientId);
  });

  it('addRecruiterStep records the client-only timing, never sent to the backend shape', () => {
    let draft = createDraft(acme);
    draft = addRecruiterStep(draft, { recruiterIdentifier: 'jane@acme.example' }, 'start');
    draft = addRecruiterStep(draft, { recruiterIdentifier: 'bob@acme.example' }, 'end');

    expect(draft.recruiterInteractions).toHaveLength(2);
    expect(draft.recruiterInteractions[0].timing).toBe('start');
    expect(draft.recruiterInteractions[1].timing).toBe('end');
  });

  it('tolerates corrupted localStorage data by treating it as no drafts', () => {
    window.localStorage.setItem('interview-insights:drafts:v1', 'not json');
    expect(listDrafts()).toEqual([]);
  });

  describe('validateDraft (GitHub issue #281)', () => {
    it('flags an empty role title', () => {
      const draft = createDraft(acme);
      const issues = validateDraft(draft);
      expect(issues).toContainEqual({ stepId: 'process', message: 'Role title is required.' });
    });

    it('flags an empty recruiter identifier, scoped to that step\'s clientId', () => {
      let draft = createDraft(acme);
      draft = { ...draft, process: { ...draft.process, roleTitle: 'Engineer' } };
      draft = addRecruiterStep(draft, { recruiterIdentifier: '  ' }, 'start');

      const issues = validateDraft(draft);
      expect(issues).toContainEqual({
        stepId: draft.recruiterInteractions[0].clientId,
        message: 'Recruiter touchpoint 1 needs a name or email.',
      });
    });

    it('flags an out-of-range round rating', () => {
      let draft = createDraft(acme);
      draft = { ...draft, process: { ...draft.process, roleTitle: 'Engineer' } };
      draft = addRoundStep(draft, {
        sequenceNumber: 1,
        title: 'Screen',
        roundType: 'coding',
        rating: { difficulty: 3, fluency: 3, clarity: 3, focus: 6 },
      });

      const issues = validateDraft(draft);
      expect(issues).toContainEqual({
        stepId: draft.rounds[0].clientId,
        message: "Round 1's rating fields must all be between 1 and 5.",
      });
    });

    it('flags an out-of-range overall experience rating', () => {
      let draft = createDraft(acme);
      draft = { ...draft, process: { ...draft.process, roleTitle: 'Engineer' } };
      draft = setOverallReview(draft, { overallExperience: 0, wouldRecommend: true });

      const issues = validateDraft(draft);
      expect(issues).toContainEqual({
        stepId: 'overall',
        message: 'Overall experience rating must be between 1 and 5.',
      });
    });

    it('returns no issues for a fully valid draft', () => {
      let draft = createDraft(acme);
      draft = { ...draft, process: { ...draft.process, roleTitle: 'Engineer' } };
      draft = addRoundStep(draft, { sequenceNumber: 1, title: 'Screen', roundType: 'coding' });
      draft = addRecruiterStep(draft, { recruiterIdentifier: 'jane@acme.example' }, 'start');

      expect(validateDraft(draft)).toEqual([]);
    });

    it('does not flag a round with no title at all (GitHub issue #287 — optional)', () => {
      let draft = createDraft(acme);
      draft = { ...draft, process: { ...draft.process, roleTitle: 'Engineer' } };
      draft = addRoundStep(draft, { sequenceNumber: 1, roundType: 'coding' });

      expect(validateDraft(draft)).toEqual([]);
    });
  });
});
