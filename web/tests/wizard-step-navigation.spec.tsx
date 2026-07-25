import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

const fieldOptionsResponse = {
  tech_screening: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  coding: {
    fields: [
      { key: 'problemAlgorithms', kind: 'controlled-multi', options: ['DFS', 'BFS'] },
      { key: 'problemDescription', kind: 'text' },
    ],
  },
  system_design: { fields: [{ key: 'keyConcepts', kind: 'controlled-multi', options: ['Caching'] }] },
  case_study: { fields: [] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
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
    // Role title is required (issue #281) and Next is now the only way to
    // add a round (issue #319) — fill it up front so Next isn't blocked.
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');
  }

  // GitHub issue #319 — the sidebar's direct "Add a round" control is
  // gone; adding a round is only reachable via the Next-button modal, and
  // the modal's select defaults to unselected ("None") with "Add new
  // round" disabled until a real type is chosen.
  async function addRound(user: ReturnType<typeof userEvent.setup>, roundType = 'coding') {
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.selectOptions(within(dialog).getByLabelText('Round type'), roundType);
    await user.click(within(dialog).getByRole('button', { name: 'Add new round' }));
  }

  it('adds two rounds of the same type and keeps their data independent', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await addRound(user);
    expect(await screen.findByRole('heading', { name: 'Coding round' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Title/), 'Screen 1');

    await addRound(user);
    await screen.findByRole('heading', { name: 'Coding round' });
    await user.type(screen.getByLabelText(/Title/), 'Screen 2');

    expect(await screen.findByText(/Round 1: Coding - Screen 1/)).toBeInTheDocument();
    expect(await screen.findByText(/Round 2: Coding - Screen 2/)).toBeInTheDocument();

    // Navigate back to round 1 and confirm its own title is still intact,
    // not overwritten by round 2's edits.
    await user.click(screen.getByText(/Round 1: Coding - Screen 1/));
    expect(await screen.findByDisplayValue('Screen 1')).toBeInTheDocument();
  });

  it('removing one round step does not affect the other', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await addRound(user);
    await user.type(await screen.findByLabelText(/Title/), 'Keep me');
    await addRound(user);
    await user.type(await screen.findByLabelText(/Title/), 'Remove me');

    await user.click(screen.getByText(/Round 2: Coding - Remove me/));
    await user.click(screen.getByRole('button', { name: 'Remove this round' }));

    expect(screen.queryByText(/Remove me/)).not.toBeInTheDocument();
    expect(screen.getByText(/Round 1: Coding - Keep me/)).toBeInTheDocument();
  });

  it('renders registry-driven type_metadata fields for the selected round type', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await addRound(user);
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

  it('shows a "?" tooltip button explaining each recruiter trait rating on hover (GitHub issues #286, #305)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.click(await screen.findByLabelText('I have a rating for this touchpoint'));

    expect(screen.queryByText(/How easy the recruiter/)).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'reachability help' }));
    expect(
      await screen.findByText('How easy the recruiter was to reach or get a response from.'),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole('button', { name: 'reachability help' }));
    expect(screen.queryByText(/How easy the recruiter/)).not.toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'responsiveness help' }));
    expect(await screen.findByText(/followed up/)).toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'guidelinesShared help' }));
    expect(await screen.findByText(/explained the process/)).toBeInTheDocument();

    await user.hover(
      screen.getByRole('button', { name: 'Rejection message authenticity help' }),
    );
    expect(await screen.findByText(/genuine or personalized/)).toBeInTheDocument();
  });

  it('shows a "?" tooltip button explaining each round trait rating on hover (GitHub issue #305)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await addRound(user);

    await user.hover(screen.getByRole('button', { name: 'difficulty help' }));
    expect(
      await screen.findByText(/property of the round, not the interviewer/),
    ).toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'fluency help' }));
    expect(await screen.findByText(/how clearly the interviewer communicated/i)).toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'clarity help' }));
    expect(await screen.findByText(/problem statement/)).toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'focus help' }));
    expect(await screen.findByText(/attentive and present/)).toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'Technical depth help' }));
    expect(await screen.findByText(/beyond the surface level/)).toBeInTheDocument();
  });

  it('a round step survives a reload with its rating intact', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await addRound(user);
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    // GitHub issue #282 — a new round's rating is available by default,
    // no opt-in click needed.
    expect(await screen.findByLabelText('I have a rating for this round')).toBeChecked();

    cleanup(); // simulate a real reload: unmount the old tree first
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await user.click(await screen.findByText(/Round 1: Coding - Screen/));
    expect(await screen.findByLabelText('I have a rating for this round')).toBeChecked();
  });

  it('"Next" advances process -> round -> (via the sidebar) recruiter steps -> overall -> review (GitHub issues #283, #319)', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    // Still on "Process details" — Next should go straight into adding
    // the first round, since none exists yet.
    await addRound(user);
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'jane@acme.example');

    await user.click(screen.getByRole('button', { name: 'Process details' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByDisplayValue('Screen')).toBeInTheDocument();

    // GitHub issue #319 — Next from the last round still opens the
    // add-round modal, but "Cancel" (renamed from "No, continue") no
    // longer navigates anywhere — it just closes the modal, leaving the
    // candidate on the round. Reaching the already-existing recruiter
    // step from here is only possible via the sidebar now.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Add another round' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Screen')).toBeInTheDocument(); // still on the round

    await user.click(screen.getByText(/Recruiter \(pre-interview\): jane@acme.example/));
    expect(await screen.findByDisplayValue('jane@acme.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Overall review' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Review your submission')).toBeInTheDocument();
    // Review & Submit is the final sequence step — no further Next button.
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });
});
