import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

const fieldOptionsResponse = {
  coding: { fields: [] },
  system_design: { fields: [] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
  case_study: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  other: { fields: [] },
};

function mockFetchByRoute(overrides: Partial<Record<string, () => Promise<unknown>>> = {}) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const respond = (body: unknown, status = 200) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies') && method === 'GET') {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/round-types/field-options')) {
      return respond(fieldOptionsResponse);
    }
    if (url.includes('/processes/bulk') && method === 'POST') {
      if (overrides.bulkSubmit) return overrides.bulkSubmit();
      return respond({ id: 'process-1' });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('Wizard review & bulk submit (GitHub issue #255)', () => {
  beforeEach(() => {
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
  });

  async function openDraft(user: ReturnType<typeof userEvent.setup>) {
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    await screen.findByRole('heading', { name: 'Acme Corp' });
  }

  it('sorts steps chronologically regardless of fill order (recruiter-start, rounds by sequence, recruiter-end)', async () => {
    mockFetchByRoute();
    const user = userEvent.setup();
    await openDraft(user);

    // Add an "after rounds" recruiter step first, then a round, then a
    // "before rounds" recruiter step — deliberately out of chronological
    // order to prove the review screen re-sorts rather than showing fill
    // order.
    await user.click(screen.getByRole('button', { name: '+ Recruiter (after rounds)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'end-recruiter@example.com');

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Only Round');

    await user.click(screen.getByRole('button', { name: '+ Recruiter (before rounds)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'start-recruiter@example.com');

    await user.click(screen.getByText('Review & Submit'));
    await screen.findByText('Review your submission');

    // Scope to the review screen's own <ol> — the step navigator (always
    // visible alongside it) has its own <li>s for the same steps, so a
    // page-wide listitem query would mix the two lists together.
    const reviewList = screen.getByText('Review your submission').nextElementSibling;
    if (!reviewList) throw new Error('Review screen list not found');
    const text = reviewList.textContent ?? '';
    const startIndex = text.indexOf('start-recruiter@example.com');
    const roundIndex = text.indexOf('Only Round');
    const endIndex = text.indexOf('end-recruiter@example.com');

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(roundIndex).toBeGreaterThan(startIndex);
    expect(endIndex).toBeGreaterThan(roundIndex);
  });

  it('an edit link on the review screen jumps back to that step', async () => {
    mockFetchByRoute();
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    await user.click(screen.getByText('Review & Submit'));

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    await user.click(editButtons[0]);

    expect(await screen.findByDisplayValue('Screen')).toBeInTheDocument();
  });

  it('submits successfully, clears the draft, and shows a pending-status summary', async () => {
    mockFetchByRoute();
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    await user.click(screen.getByLabelText('I have a rating for this round'));

    await user.click(screen.getByText('Review & Submit'));
    await user.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Submitted!')).toBeInTheDocument();
    expect(screen.getByText(/1 round rating is pending moderation/)).toBeInTheDocument();

    // The draft is gone — back at the empty "start a new draft" screen,
    // not the old draft.
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(screen.queryByText(/Acme Corp — Screen/)).not.toBeInTheDocument();
  });

  it('a submission failure leaves the draft intact and shows the error', async () => {
    mockFetchByRoute({
      bulkSubmit: () =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ message: 'Invalid value(s) for "problemAlgorithms".' }),
        }),
    });
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    await user.click(screen.getByText('Review & Submit'));
    await user.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(/Invalid value\(s\)/)).toBeInTheDocument();
    // Draft still exists (with its round still in it) — back to my drafts
    // should not lose it, and resuming shows the round untouched.
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(await screen.findByText('Your drafts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect((await screen.findAllByText(/Round 1: Screen/)).length).toBeGreaterThan(0);
  });

  it('gates the submit button behind login, leaving the review content visible', async () => {
    document.cookie = 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
    mockFetchByRoute();
    const user = userEvent.setup();

    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    // Company creation is gated, but selecting an *existing* company and
    // drafting needs no session at all (issue #253/#255) — only submit does.
    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText('Title'), 'Screen');
    await user.click(screen.getByText('Review & Submit'));

    expect(await screen.findByText('Review your submission')).toBeInTheDocument();
    expect((await screen.findAllByText(/Round 1: Screen/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Log in to unlock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });
});
