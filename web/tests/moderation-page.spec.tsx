import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ModerationPage from '../src/app/moderation/page';

const push = jest.fn();
// A single stable object, not a fresh literal per call — matches real
// Next.js's useRouter() (a memoized, stable reference across renders).
// An unstable mock here previously caused the queue-load effect (which
// now depends on `router` too, for the mid-session-401 redirect) to
// re-fire on every render, refetching and clobbering an optimistic
// client-side removal from an approve/reject/flag action.
const mockRouter = { push };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const queueEntries = [
  {
    id: 'q-round',
    entityType: 'round_rating',
    entityId: 'rr1',
    flagReason: 'duplicate',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-19T00:00:00Z',
    entity: {
      companyName: 'Acme Corp',
      roleTitle: 'Engineer',
      roundTitle: 'Screen',
      roundType: 'coding',
      difficulty: 3,
      fluency: 4,
      clarity: 4,
      focus: 4,
      technicalDepth: null,
      freeText: 'tough but fair',
    },
  },
  {
    id: 'q-recruiter',
    entityType: 'recruiter_rating',
    entityId: 'cr1',
    flagReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-19T00:01:00Z',
    entity: {
      companyName: 'Acme Corp',
      roleTitle: 'Engineer',
      recruiterLabel: 'Recruiter A',
      approachability: 5,
      responseTime: 4,
      timeliness: 5,
      communicationQuality: 5,
      freeText: null,
    },
  },
  {
    id: 'q-overall',
    entityType: 'overall_review',
    entityId: 'ov1',
    flagReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-19T00:02:00Z',
    entity: {
      companyName: 'Acme Corp',
      roleTitle: 'Engineer',
      overallExperience: 4,
      wouldRecommend: true,
      reviewText: 'good loop overall',
    },
  },
];

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/admin/me') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'admin' }) });
    }
    if (url.endsWith('/auth/admin/logout') && method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    }
    if (url.endsWith('/moderation/queue') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(queueEntries) });
    }
    if (/\/moderation\/queue\/.+\/(approve|reject|flag)$/.test(url) && method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('ModerationPage (Phase 14 issue #128; session gating Phase 18 issue #160)', () => {
  beforeEach(() => {
    push.mockClear();
    mockFetch();
  });

  it('redirects to the login page when the session check 401s', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/admin/me')) {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    render(<ModerationPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
    // Never falls through to rendering the queue while unauthenticated.
    expect(screen.queryByText('Moderation queue')).not.toBeInTheDocument();
  });

  it('redirects to the login page when the queue load itself 401s (session expired after the initial check passed)', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/admin/me') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'admin' }) });
      }
      if (url.endsWith('/moderation/queue') && method === 'GET') {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }) as jest.Mock;

    render(<ModerationPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
    // A distinct code path from the session-check 401 above — this one
    // passed the initial gate and only failed on the queue fetch itself.
    expect(screen.queryByText(/failed with 401/)).not.toBeInTheDocument();
  });

  it('redirects to the login page when a moderation action 401s mid-session', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/admin/me') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'admin' }) });
      }
      if (url.endsWith('/moderation/queue') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(queueEntries) });
      }
      if (/\/moderation\/queue\/.+\/approve$/.test(url) && method === 'POST') {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<ModerationPage />);

    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0]);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
    // Not shown as a generic inline error — this is a redirect, not a failure.
    expect(screen.queryByText(/failed with 401/)).not.toBeInTheDocument();
  });

  it('logs out and redirects to the login page', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: 'Log out' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/logout'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(push).toHaveBeenCalledWith('/moderation/login');
  });

  it('renders all three entity types with their context, generated labels only', async () => {
    render(<ModerationPage />);

    expect(await screen.findByText('Round rating')).toBeInTheDocument();
    expect(screen.getByText('Recruiter rating')).toBeInTheDocument();
    expect(screen.getByText('Overall review')).toBeInTheDocument();
    // Context rendered without a second lookup
    expect(screen.getByText('tough but fair')).toBeInTheDocument();
    expect(screen.getByText(/Recruiter A/)).toBeInTheDocument();
    expect(screen.getByText('good loop overall')).toBeInTheDocument();
    // Fraud-check flag reason surfaced
    expect(screen.getByText(/Auto-flagged: duplicate/)).toBeInTheDocument();
  });

  it('approve calls the endpoint and removes the entry from the list', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/moderation/queue/q-round/approve'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Round rating')).not.toBeInTheDocument());
    // The other two are untouched
    expect(screen.getByText('Recruiter rating')).toBeInTheDocument();
  });

  it('reject calls the endpoint and removes the entry', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    const rejectButtons = await screen.findAllByRole('button', { name: 'Reject' });
    await user.click(rejectButtons[1]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/moderation/queue/q-recruiter/reject'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Recruiter rating')).not.toBeInTheDocument());
  });

  it('flag sends the selected reason and removes the entry', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await screen.findByText('Overall review');
    await user.selectOptions(screen.getByLabelText('Flag reason for q-overall'), 'spam_pattern');
    const flagButtons = screen.getAllByRole('button', { name: 'Flag' });
    await user.click(flagButtons[2]);

    await waitFor(() => {
      const call = (global.fetch as jest.Mock).mock.calls.find(([url]: [string]) =>
        String(url).includes('/moderation/queue/q-overall/flag'),
      ) as [string, RequestInit] | undefined;
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1].body))).toMatchObject({ flagReason: 'spam_pattern' });
    });
    await waitFor(() => expect(screen.queryByText('Overall review')).not.toBeInTheDocument());
  });

  it('shows the empty state when the queue is clear, distinct from loading', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }) as jest.Mock;

    render(<ModerationPage />);
    // While the fetch is unresolved React shows Loading…, then the explicit
    // empty state — never a silently blank list.
    expect(await screen.findByText(/Queue is clear/)).toBeInTheDocument();
  });
});
