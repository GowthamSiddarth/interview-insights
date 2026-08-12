import { act, render, screen, within } from './test-utils';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/write-review/page';

// The wizard now receives its company via query params instead of its own
// picker (a "Write a review" link from the search/landing page).
jest.mock('next/navigation', () => {
  const params = new URLSearchParams(
    'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
  );
  return {
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => params,
  };
});

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

function logOut() {
  document.cookie = 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('Session-expiry warning mid-draft (GitHub issue #301)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('warns within one poll interval once the session cookie disappears, without losing the draft', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });

    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');

    // Simulate the session dying mid-draft — the poll should notice on its
    // own, without the candidate clicking anything.
    logOut();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(
      await screen.findByText(/Your session has expired\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute(
      'href',
      '/login',
    );
    // The draft itself is untouched.
    expect(screen.getByDisplayValue('Backend Engineer')).toBeInTheDocument();
  });

  it('never warns for a candidate who was never logged in', async () => {
    logOut();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<HomePage />);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.queryByText(/Your session has expired\./)).not.toBeInTheDocument();
  });

  it('clears the warning once a later poll sees a valid session again', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });

    logOut();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await screen.findByText(/Your session has expired\./);

    // Logged back in, e.g. in another tab.
    document.cookie = 'candidate_logged_in=1';
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(screen.queryByText(/Your session has expired\./)).not.toBeInTheDocument();
  });

  it('shows a clear session-expired message (not the generic fallback) when submit itself gets a 401', async () => {
    mockFetchByRoute({
      bulkSubmit: () =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        }),
    });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');
    // GitHub issue #319 — adding a round is only reachable via the
    // Next-button modal now (the sidebar's direct control is gone).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.selectOptions(within(dialog).getByLabelText('Round type'), 'coding');
    await user.click(within(dialog).getByRole('button', { name: 'Add new round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Screen');

    await user.click(screen.getByText('Review & Submit'));
    // GitHub issue #307 — no recruiter touchpoints added, so the
    // non-blocking reminder shows "Submit anyway" instead of "Submit".
    await user.click(await screen.findByRole('button', { name: 'Submit anyway' }));

    expect(
      await screen.findByText(/Your session has expired\. Log in again to submit/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Please check the highlighted fields and try again.'),
    ).not.toBeInTheDocument();

    // The review screen's own gate should now show the login prompt too,
    // since the failed submit corrected the session state immediately
    // rather than waiting for the next poll.
    expect(screen.getByRole('link', { name: 'Log in to unlock' })).toBeInTheDocument();
  });
});
