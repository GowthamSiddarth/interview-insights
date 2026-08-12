import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StepNavigator } from '../src/app/wizard/step-navigator';
import { ProcessDraft } from '../src/lib/draft-store';

function makeDraft(overrides: Partial<ProcessDraft> = {}): ProcessDraft {
  return {
    id: 'draft-1',
    companyId: 'company-1',
    companyName: 'Acme Corp',
    companySlug: 'acme-corp',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    process: { roleTitle: '', outcome: 'in_progress', level: '', department: '', applicationDate: '' },
    rounds: [],
    recruiterInteractions: [],
    ...overrides,
  };
}

const noop = () => {};

describe('StepNavigator progress (GitHub issue #621)', () => {
  it('counts process/review as structural, not part of the rated total', () => {
    render(<StepNavigator draft={makeDraft()} activeStepId="process" onSelect={noop} onAddRecruiter={noop} />);
    // Only the always-present "overall review" slot counts when there
    // are no rounds/recruiter interactions yet.
    expect(screen.getByText('0 of 1 rated')).toBeInTheDocument();
  });

  it('counts a round as rated only once it actually has a rating attached', () => {
    const draft = makeDraft({
      rounds: [
        {
          clientId: 'r1',
          round: {
            sequenceNumber: 1,
            roundType: 'coding',
            rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
          },
        },
        { clientId: 'r2', round: { sequenceNumber: 2, roundType: 'behavioral' } },
      ],
    });
    render(<StepNavigator draft={draft} activeStepId="process" onSelect={noop} onAddRecruiter={noop} />);
    // 1 rated round + the unrated overall slot, out of 2 rounds + 1 overall = 3.
    expect(screen.getByText('1 of 3 rated')).toBeInTheDocument();
  });

  it('reflects the overall review once it exists', () => {
    const draft = makeDraft({
      overallReview: { overallExperience: 4, wouldRecommend: true },
    });
    render(<StepNavigator draft={draft} activeStepId="process" onSelect={noop} onAddRecruiter={noop} />);
    expect(screen.getByText('1 of 1 rated')).toBeInTheDocument();
  });
});
