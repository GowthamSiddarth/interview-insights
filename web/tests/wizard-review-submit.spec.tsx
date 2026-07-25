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
    // Role title is required (GitHub issue #281's pre-submit validation) —
    // fill it up front so every test below starts from a submittable draft
    // unless it's deliberately testing an invalid one.
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');
  }

  it('sorts steps chronologically regardless of fill order (recruiter-start, rounds by sequence, recruiter-end)', async () => {
    mockFetchByRoute();
    const user = userEvent.setup();
    await openDraft(user);

    // Add a "post-interview" recruiter step first, then a round, then a
    // "pre-interview" recruiter step — deliberately out of chronological
    // order to prove the review screen re-sorts rather than showing fill
    // order.
    await user.click(screen.getByRole('button', { name: '+ Recruiter (post-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'end-recruiter@example.com');

    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Only Round');

    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
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
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
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
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    // GitHub issue #282 — a rating is already attached by default, no
    // opt-in click needed.
    expect(await screen.findByLabelText('I have a rating for this round')).toBeChecked();

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
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    await user.click(screen.getByText('Review & Submit'));
    await user.click(await screen.findByRole('button', { name: 'Submit' }));

    // GitHub issue #281 — a backend error shape this app's own humanizer
    // doesn't specifically recognize falls back to a plain-English message,
    // never the raw string the backend actually sent.
    expect(
      await screen.findByText('Please check the highlighted fields and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invalid value\(s\)/)).not.toBeInTheDocument();
    // Draft still exists (with its round still in it) — back to my drafts
    // should not lose it, and resuming shows the round untouched.
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(await screen.findByText('Your drafts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect((await screen.findAllByText(/Round 1: Coding - Screen/)).length).toBeGreaterThan(0);
  });

  it('blocks submit and shows a plain-English fix list for an incomplete draft (GitHub issue #281)', async () => {
    mockFetchByRoute();
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    // Deliberately leave Role title empty, add a recruiter touchpoint with
    // no identifier — the two required-field cases the original bug report
    // was about.
    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.click(screen.getByText('Review & Submit'));

    expect(await screen.findByText('Role title is required.')).toBeInTheDocument();
    expect(
      screen.getByText('Recruiter touchpoint 1 needs a name or email.'),
    ).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: 'Submit' });
    expect(submitButton).toBeDisabled();

    // The network call must never even fire for an invalid draft.
    const bulkCalls = (global.fetch as jest.Mock).mock.calls.filter(([input, init]) =>
      String(input).includes('/processes/bulk') && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(bulkCalls).toHaveLength(0);

    // A "Fix" link jumps straight back to the offending step.
    await user.click(screen.getAllByRole('button', { name: 'Fix' })[0]);
    expect(await screen.findByLabelText('Role title')).toBeInTheDocument();
  });

  it('humanizes a "should not be empty" backend error instead of showing the raw dotted path (GitHub issue #281)', async () => {
    mockFetchByRoute({
      bulkSubmit: () =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              message: ['recruiterInteractions.0.recruiterIdentifier should not be empty'],
            }),
        }),
    });
    const user = userEvent.setup();
    await openDraft(user);

    // A round alone is enough to pass client-side validation (recruiter
    // steps aren't added here) — this exercises the backend-error fallback
    // path specifically, simulating a shape the client-side check itself
    // didn't catch.
    await user.click(screen.getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    await user.click(screen.getByText('Review & Submit'));
    await user.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(
      await screen.findByText('Recruiter touchpoint 1: Recruiter name or email is required.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/recruiterInteractions\.0/)).not.toBeInTheDocument();
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
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    await user.click(screen.getByText('Review & Submit'));

    expect(await screen.findByText('Review your submission')).toBeInTheDocument();
    expect((await screen.findAllByText(/Round 1: Coding - Screen/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Log in to unlock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });
});
