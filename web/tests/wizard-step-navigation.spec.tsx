import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

const fieldOptionsResponse = {
  coding: {
    fields: [
      { key: 'problemAlgorithms', kind: 'controlled-multi', options: ['DFS', 'BFS'] },
      { key: 'problemDescription', kind: 'text' },
    ],
  },
  system_design: { fields: [{ key: 'keyConcepts', kind: 'controlled-multi', options: ['Caching'] }] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
  case_study: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  other: { fields: [{ key: 'notes', kind: 'text' }] },
};

function mockFetchByRoute() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies')) {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/round-types/field-options')) {
      return respond(fieldOptionsResponse);
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('Wizard step navigation (GitHub issue #254)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
  });

  async function openDraft(user: ReturnType<typeof userEvent.setup>) {
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    await screen.findByRole('heading', { name: 'Acme Corp' });
  }

  it('adds two rounds of the same type and keeps their data independent', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    expect(await screen.findByRole('heading', { name: 'Coding round' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), 'Screen 1');

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await screen.findByRole('heading', { name: 'Coding round' });
    await user.type(screen.getByLabelText('Title'), 'Screen 2');

    expect(await screen.findByText(/Round 1: Screen 1/)).toBeInTheDocument();
    expect(await screen.findByText(/Round 2: Screen 2/)).toBeInTheDocument();

    // Navigate back to round 1 and confirm its own title is still intact,
    // not overwritten by round 2's edits.
    await user.click(screen.getByText(/Round 1: Screen 1/));
    expect(await screen.findByDisplayValue('Screen 1')).toBeInTheDocument();
  });

  it('removing one round step does not affect the other', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Keep me');
    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Remove me');

    await user.click(screen.getByText(/Round 2: Remove me/));
    await user.click(screen.getByRole('button', { name: 'Remove this round' }));

    expect(screen.queryByText(/Remove me/)).not.toBeInTheDocument();
    expect(screen.getByText(/Round 1: Keep me/)).toBeInTheDocument();
  });

  it('renders registry-driven type_metadata fields for the selected round type', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    expect(await screen.findByText('DFS')).toBeInTheDocument();
    expect(screen.getByText('Problem Description')).toBeInTheDocument();
  });

  it('adds a recruiter step with the chosen timing, independent of round steps', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    expect(await screen.findByRole('heading', { name: 'Recruiter touchpoint' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Recruiter name or email/), 'jane@acme.example');

    expect(await screen.findByText(/Recruiter \(pre-interview\): jane@acme.example/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Recruiter (post-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'bob@acme.example');
    expect(await screen.findByText(/Recruiter \(post-interview\): bob@acme.example/)).toBeInTheDocument();

    // Both steps still present and independent.
    expect(screen.getByText(/Recruiter \(pre-interview\): jane@acme.example/)).toBeInTheDocument();
  });

  it('shows the recruiter step\'s timing as read-only text, already chosen at add-time (GitHub issue #285)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    expect(await screen.findByText('Before my interview')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /When was this/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Recruiter (post-interview)' }));
    expect(await screen.findByText('After my interview')).toBeInTheDocument();
  });

  it('shows a tooltip explaining each recruiter trait rating (GitHub issue #286)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.click(await screen.findByLabelText('I have a rating for this touchpoint'));

    expect(screen.getByText('reachability').closest('label')).toHaveAttribute(
      'title',
      'How easy the recruiter was to reach or get a response from.',
    );
    expect(screen.getByText('responsiveness').closest('label')).toHaveAttribute(
      'title',
      expect.stringContaining('followed up'),
    );
    expect(screen.getByText('guidelines Shared').closest('label')).toHaveAttribute(
      'title',
      expect.stringContaining('explained the process'),
    );
    expect(
      screen.getByText(/Rejection message authenticity/).closest('label'),
    ).toHaveAttribute('title', expect.stringContaining('genuine or personalized'));
  });

  it('a round step survives a reload with its rating intact', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    // GitHub issue #282 — a new round's rating is available by default,
    // no opt-in click needed.
    expect(await screen.findByLabelText('I have a rating for this round')).toBeChecked();

    cleanup(); // simulate a real reload: unmount the old tree first
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await user.click(await screen.findByText(/Round 1: Screen/));
    expect(await screen.findByLabelText('I have a rating for this round')).toBeChecked();
  });

  it('"Next" advances process -> rounds -> recruiter steps -> overall -> review, live-recomputed as steps are added (GitHub issue #283)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    // Still on "Process details" — Next should go straight to the round,
    // since no recruiter step exists yet at this point.
    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'jane@acme.example');

    await user.click(screen.getByRole('button', { name: 'Process details' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByDisplayValue('Screen')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByDisplayValue('jane@acme.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Overall review' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Review your submission')).toBeInTheDocument();
    // Review & Submit is the final sequence step — no further Next button.
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });
});
