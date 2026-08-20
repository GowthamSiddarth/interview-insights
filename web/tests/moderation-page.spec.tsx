import { act, render, screen, waitFor } from '@testing-library/react';
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

// GitHub issue #315: the queue groups every pending entity by its
// InterviewProcess ("submission") — one collapsed row per submission, full
// detail revealed on expand. This fixture puts the round + recruiter
// entities under the same process (process-1) and the overall review under
// a different one (process-2), matching the real grouping behavior.
const queueGroups = [
  {
    processId: 'process-1',
    companyName: 'Acme Corp',
    roleTitle: 'Engineer',
    entries: [
      {
        id: 'q-round',
        entityType: 'round_rating',
        entityId: 'rr1',
        flagReason: 'duplicate',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-07-19T00:00:00Z',
        slaDeadline: '2026-07-21T00:00:00Z',
        claimedBy: null,
        claimedAt: null,
        priorReviews: [],
        entity: {
          processId: 'process-1',
          companyName: 'Acme Corp',
          roleTitle: 'Engineer',
          roundTitle: 'Screen',
          roundType: 'coding',
          roundDescription: 'A live coding round over a shared editor',
          roundTypeMetadata: { problemAlgorithms: ['DFS'] },
          roundScheduledDurationMinutes: 45,
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: 'tough but fair',
          // GitHub issue #163 (Phase 19) — advisory LLM triage verdict.
          moderationVerdict: {
            concerning: true,
            reasons: ['mentions a specific interviewer by name'],
            summary: 'Free text may reveal interviewer identity.',
          },
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
        slaDeadline: '2026-07-21T00:01:00Z',
        // GitHub issue #487 — claimed by a moderator other than the
        // signed-in one (see mockFetch's /auth/admin/me response), so the
        // badge/no-Release-button branch has fixture coverage too.
        claimedBy: { id: 'mod-other', username: 'other-mod' },
        claimedAt: '2026-07-19T01:00:00Z',
        priorReviews: [],
        entity: {
          processId: 'process-1',
          companyName: 'Acme Corp',
          roleTitle: 'Engineer',
          recruiterLabel: 'Recruiter A',
          reachability: 5,
          responsiveness: 4,
          guidelinesShared: 5,
          rejectionMessageAuthenticity: null,
          freeText: null,
        },
      },
    ],
  },
  {
    processId: 'process-2',
    companyName: 'Acme Corp',
    roleTitle: 'Manager',
    entries: [
      {
        id: 'q-overall',
        entityType: 'overall_review',
        entityId: 'ov1',
        flagReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-07-19T00:02:00Z',
        slaDeadline: '2026-07-21T00:02:00Z',
        claimedBy: null,
        claimedAt: null,
        priorReviews: [],
        entity: {
          processId: 'process-2',
          companyName: 'Acme Corp',
          roleTitle: 'Manager',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop overall',
        },
      },
    ],
  },
  // GitHub issue #369 (Phase 35) — a create-company request has no
  // InterviewProcess of its own, so it stands alone in its own group.
  {
    processId: 'company-request-comp1',
    companyName: 'Globex Corp',
    roleTitle: 'New company request',
    entries: [
      {
        id: 'q-company',
        entityType: 'company',
        entityId: 'comp1',
        flagReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-07-19T00:03:00Z',
        slaDeadline: '2026-07-21T00:03:00Z',
        claimedBy: null,
        claimedAt: null,
        priorReviews: [],
        entity: {
          processId: 'company-request-comp1',
          companyName: 'Globex Corp',
          roleTitle: 'New company request',
          requestedCompanySlug: 'globex-corp',
          requestedCompanySizeBucket: 'large',
          requestedCompanyIndustry: 'Manufacturing',
        },
      },
    ],
  },
];

// GitHub issue #371 (Phase 35) — a mutable module-level result set so
// individual tests can control what GET /moderation/search returns
// without needing their own bespoke fetch mock.
let searchResultsMock: unknown[] = [];

// GitHub issue #523 (Phase 41) — the filter row's Company <select> is
// populated from this, same as the real /companies list.
const companiesMock = [
  { id: 'comp-acme', name: 'Acme Corp', slug: 'acme-corp', industry: null, sizeBucket: 'mid', logoUrl: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'comp-globex', name: 'Globex Corp', slug: 'globex-corp', industry: null, sizeBucket: 'large', logoUrl: null, createdAt: '2026-01-01T00:00:00Z' },
];

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/admin/me') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }) });
    }
    if (url.endsWith('/auth/admin/logout') && method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    }
    if (url.endsWith('/companies') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: companiesMock, total: companiesMock.length, page: 1, pageSize: 200 }) });
    }
    if (url.includes('/moderation/queue') && !url.includes('/moderation/queue/') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(queueGroups) });
    }
    if (url.includes('/moderation/search') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(searchResultsMock) });
    }
    if (/\/moderation\/queue\/.+\/(approve|reject|flag)$/.test(url) && method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (/\/moderation\/queue\/.+\/claim$/.test(url) && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ claimedBy: { id: 'mod-me', username: 'admin' }, claimedAt: '2026-07-19T02:00:00Z' }),
      });
    }
    if (/\/moderation\/queue\/.+\/release$/.test(url) && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ claimedBy: null, claimedAt: null }),
      });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('ModerationPage (Phase 14 issue #128; session gating Phase 18 issue #160; grouped-by-submission Phase 29 issue #315)', () => {
  beforeEach(() => {
    push.mockClear();
    searchResultsMock = [];
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }) });
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }) });
      }
      if (url.endsWith('/moderation/queue') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(queueGroups) });
      }
      if (/\/moderation\/queue\/.+\/approve$/.test(url) && method === 'POST') {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));
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

  it('renders one collapsed row per submission, not one row per entity', async () => {
    render(<ModerationPage />);

    expect(await screen.findByText('Acme Corp · Engineer')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp · Manager')).toBeInTheDocument();
    expect(screen.getByText('Globex Corp · New company request')).toBeInTheDocument();
    expect(screen.getByText('2 pending items')).toBeInTheDocument();
    // Manager's submission and the standalone company request each show
    // exactly one pending item.
    expect(screen.getAllByText('1 pending item')).toHaveLength(2);
    // Nothing about the individual entities is visible until expanded.
    expect(screen.queryByText('Round rating')).not.toBeInTheDocument();
    expect(screen.queryByText('tough but fair')).not.toBeInTheDocument();
  });

  // GitHub issue #490 (Phase 36, D80) — a time-remaining/overdue
  // indicator per entry, driven by slaDeadline. The fixture's
  // slaDeadline values are all fixed 2026-07-19 dates, long past by the
  // time this test actually runs — deterministically "overdue" no
  // matter when the suite executes.
  it('shows an overdue SLA badge on each entry once its group is expanded', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));

    expect(screen.getAllByText(/Overdue by/).length).toBeGreaterThan(0);
  });

  it('shows a "Due in" badge, not overdue, for an entry whose deadline is still in the future', async () => {
    const futureGroups = [
      {
        ...queueGroups[1],
        entries: [{ ...queueGroups[1].entries[0], slaDeadline: new Date(Date.now() + 3_600_000).toISOString() }],
      },
    ];
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/admin/me') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }) });
      }
      if (url.endsWith('/moderation/queue') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(futureGroups) });
      }
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }) as jest.Mock;
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));

    expect(screen.getByText(/Due in/)).toBeInTheDocument();
    expect(screen.queryByText(/Overdue by/)).not.toBeInTheDocument();
  });

  // GitHub issue #369 (Phase 35) — a create-company request renders with
  // its own label and detail fields, standing alone since it has no
  // InterviewProcess to group under.
  it('expanding a company creation request reveals its requested slug/size/industry', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Globex Corp · New company request/ }));

    expect(screen.getByText('Company creation request')).toBeInTheDocument();
    expect(screen.getByText('slug: globex-corp')).toBeInTheDocument();
    expect(screen.getByText('size: large')).toBeInTheDocument();
    expect(screen.getByText('industry: Manufacturing')).toBeInTheDocument();
    // GitHub issue #340 (D81) — company requests are never triaged (not
    // one of the three moderated content types), so no AI second opinion
    // block of any kind — pending or otherwise — ever renders for one.
    expect(screen.queryByText(/AI second opinion/)).not.toBeInTheDocument();
  });

  it('expanding a submission reveals its full entity detail, including round content beyond the highlighted scores', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));

    expect(screen.getByText('Round rating')).toBeInTheDocument();
    expect(screen.getByText('Recruiter rating')).toBeInTheDocument();
    expect(screen.getByText('tough but fair')).toBeInTheDocument();
    expect(screen.getByText(/Recruiter A/)).toBeInTheDocument();
    // Fraud-check flag reason surfaced
    expect(screen.getByText(/Auto-flagged: duplicate/)).toBeInTheDocument();
    // Full round content (issue #315), not just difficulty/fluency/clarity/focus
    expect(screen.getByText('A live coding round over a shared editor')).toBeInTheDocument();
    expect(screen.getByText(/scheduled duration: 45 min/)).toBeInTheDocument();
    expect(screen.getByText(/problem algorithms: DFS/)).toBeInTheDocument();
    // GitHub issue #163 (Phase 19) — advisory LLM verdict, rendered
    // distinctly from the deterministic fraud-check flag above.
    expect(screen.getByText(/AI second opinion.*flagged a concern/)).toBeInTheDocument();
    expect(screen.getByText('Free text may reveal interviewer identity.')).toBeInTheDocument();
    // The recruiter rating in the same submission has no verdict yet —
    // GitHub issue #340 (D81) renders this as a distinct "analysis
    // pending" state now, never conflated with "no concerns found" (which
    // would mean a verdict actually arrived and was clean).
    expect(screen.queryByText(/no concerns found/)).not.toBeInTheDocument();
    expect(screen.getByText(/AI second opinion.*analysis pending/)).toBeInTheDocument();

    // The other submission stays collapsed.
    expect(screen.queryByText('Overall review')).not.toBeInTheDocument();
  });

  // GitHub issue #691 (Phase 49, D104).
  it('expanding a resubmitted entry shows its prior decision, reason, note, and reviewer', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/admin/me') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }) });
      }
      if (url.endsWith('/companies') && method === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: companiesMock, total: companiesMock.length, page: 1, pageSize: 200 }) });
      }
      if (url.includes('/moderation/queue') && !url.includes('/moderation/queue/') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                ...queueGroups[0],
                entries: [
                  {
                    ...queueGroups[0].entries[0],
                    priorReviews: [
                      {
                        id: 'q-round-prior-1',
                        decision: 'rejected',
                        reviewedAt: '2026-07-18T00:00:00Z',
                        reviewedBy: 'gowtham',
                        rejectionReasonCategory: 'low_quality',
                        reviewNote: 'Free text was too vague to be useful.',
                      },
                    ],
                  },
                ],
              },
            ]),
        });
      }
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));

    expect(screen.getByText(/Resubmitted — 1 prior submission/)).toBeInTheDocument();
    expect(screen.getByText(/Rejected — Low quality/)).toBeInTheDocument();
    expect(screen.getByText('Free text was too vague to be useful.')).toBeInTheDocument();
    expect(screen.getByText(/gowtham/)).toBeInTheDocument();
  });

  it('approve calls the endpoint and removes just that entry, collapsing the group once empty', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/moderation/queue/q-overall/approve'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // That submission had exactly one entry — the whole row disappears.
    await waitFor(() => expect(screen.queryByText('Acme Corp · Manager')).not.toBeInTheDocument());
    // The other submission (still with a pending recruiter rating) is untouched.
    expect(screen.getByText('Acme Corp · Engineer')).toBeInTheDocument();
  });

  it('reject calls the endpoint and removes just that entry, keeping the group open with its remaining entry', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));
    const rejectButtons = await screen.findAllByRole('button', { name: 'Reject' });
    await user.click(rejectButtons[1]); // the recruiter rating

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/moderation/queue/q-recruiter/reject'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Recruiter rating')).not.toBeInTheDocument());
    // The round rating in the same submission is still there.
    expect(screen.getByText('Round rating')).toBeInTheDocument();
    // All three groups now show exactly one remaining pending item
    // (Engineer's count dropped from 2 to 1; Manager's and the standalone
    // company request were already 1 each).
    expect(screen.getAllByText('1 pending item')).toHaveLength(3);
  });

  it('flag sends the selected reason and removes the entry', async () => {
    const user = userEvent.setup();
    render(<ModerationPage />);

    await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));
    await screen.findByText('Overall review');
    await user.selectOptions(screen.getByLabelText('Flag reason for q-overall'), 'spam_pattern');
    await user.click(screen.getByRole('button', { name: 'Flag' }));

    await waitFor(() => {
      const call = (global.fetch as jest.Mock).mock.calls.find(([url]: [string]) =>
        String(url).includes('/moderation/queue/q-overall/flag'),
      ) as [string, RequestInit] | undefined;
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1].body))).toMatchObject({ flagReason: 'spam_pattern' });
    });
    await waitFor(() => expect(screen.queryByText('Acme Corp · Manager')).not.toBeInTheDocument());
  });

  // GitHub issue #487 (Phase 36, D80) — claim/release, and the "claimed
  // by" badge the queue read already carries via the joined Moderator
  // relation.
  describe('claim / release', () => {
    it('an unclaimed entry shows a Claim button and no badge', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);

      await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));
      expect(await screen.findAllByRole('button', { name: 'Claim' })).toHaveLength(1);
      expect(screen.queryByText(/Claimed by/)).not.toBeInTheDocument();
    });

    it('an entry claimed by another moderator shows their name, with no Release button', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);

      await user.click(await screen.findByRole('button', { name: /Acme Corp · Engineer/ }));

      expect(screen.getByText('Claimed by other-mod')).toBeInTheDocument();
      // Only the round rating (unclaimed) offers a Claim button in this
      // submission — the recruiter rating (claimed by someone else) offers
      // neither Claim nor Release.
      expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    });

    it('claiming calls the endpoint and swaps the Claim button for a "Claimed by you" badge + Release', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);

      await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));
      await user.click(await screen.findByRole('button', { name: 'Claim' }));

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/moderation/queue/q-overall/claim'),
          expect.objectContaining({ method: 'POST' }),
        ),
      );
      expect(await screen.findByText('Claimed by you')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
      // The entry is still in the queue — unlike approve/reject/flag,
      // claiming never removes it.
      expect(screen.getByText('Acme Corp · Manager')).toBeInTheDocument();
    });

    it('releasing calls the endpoint and restores the Claim button', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);

      await user.click(await screen.findByRole('button', { name: /Acme Corp · Manager/ }));
      await user.click(await screen.findByRole('button', { name: 'Claim' }));
      await screen.findByText('Claimed by you');
      await user.click(screen.getByRole('button', { name: 'Release' }));

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/moderation/queue/q-overall/release'),
          expect.objectContaining({ method: 'POST' }),
        ),
      );
      expect(await screen.findByRole('button', { name: 'Claim' })).toBeInTheDocument();
      expect(screen.queryByText('Claimed by you')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when the queue is clear, distinct from loading', async () => {
    // GitHub issue #822 (Phase 57) — GET /companies now returns a
    // paginated { items, total, page, pageSize } shape, not a bare array;
    // this blanket mock previously served [] for every URL alike.
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/companies')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 200 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as jest.Mock;

    render(<ModerationPage />);
    // While the fetch is unresolved React shows Loading…, then the explicit
    // empty state — never a silently blank list.
    expect(await screen.findByText(/Queue is clear/)).toBeInTheDocument();
  });

  // GitHub issue #523 (Phase 41) — GET /moderation/queue's own filter
  // controls (entity type, company, claim state, status), wired through
  // api.ts's listModerationQueue() so the queue reloads with the new
  // querystring on each change.
  describe('queue filters', () => {
    function lastQueueQuery(): string {
      const calls = (global.fetch as jest.Mock).mock.calls as [string][];
      const queueCalls = calls.filter(
        ([url]) => url.includes('/moderation/queue') && !url.includes('/moderation/queue/'),
      );
      return String(queueCalls[queueCalls.length - 1][0]);
    }

    it('populates the Company filter from the company list', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.click(screen.getByLabelText('Company'));
      expect(screen.getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Globex Corp' })).toBeInTheDocument();
    });

    it('selecting an entity type refetches the queue with entityType in the querystring', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.selectOptions(screen.getByLabelText('Entity type'), 'round_rating');

      await waitFor(() => expect(lastQueueQuery()).toContain('entityType=round_rating'));
    });

    it('selecting a company refetches the queue with companyId in the querystring', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.selectOptions(screen.getByLabelText('Company'), 'comp-acme');

      await waitFor(() => expect(lastQueueQuery()).toContain('companyId=comp-acme'));
    });

    it('combines claim state and status filters in a single request', async () => {
      const user = userEvent.setup();
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.selectOptions(screen.getByLabelText('Claim state'), 'unclaimed');
      await user.selectOptions(screen.getByLabelText('Status'), 'flagged');

      await waitFor(() => {
        const q = lastQueueQuery();
        expect(q).toContain('claimState=unclaimed');
        expect(q).toContain('status=flagged');
      });
    });

    it('filter controls are hidden while searching', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      jest.useFakeTimers({ advanceTimers: true });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.type(screen.getByLabelText('Search'), 'acme');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(screen.queryByLabelText('Entity type')).not.toBeInTheDocument();
      jest.useRealTimers();
    });
  });

  // GitHub issue #371 (Phase 35) — the search box + category filter,
  // replacing the grouped view with a flat list of fuzzy matches.
  describe('search', () => {
    const searchHit = {
      id: 'q-round',
      entityType: 'round_rating',
      entityId: 'rr1',
      flagReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: '2026-07-19T00:00:00Z',
      slaDeadline: '2026-07-21T00:00:00Z',
      claimedBy: null,
      claimedAt: null,
      priorReviews: [],
      entity: {
        processId: 'process-1',
        companyName: 'Acme Corp',
        roleTitle: 'Engineer',
        roundTitle: 'Screen',
        roundType: 'coding',
        difficulty: 3,
        fluency: 4,
        clarity: 4,
        focus: 4,
        freeText: 'tough but fair',
      },
    };
    const companyHit = {
      id: 'q-company',
      entityType: 'company',
      entityId: 'comp1',
      flagReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: '2026-07-19T00:03:00Z',
      slaDeadline: '2026-07-21T00:03:00Z',
      claimedBy: null,
      claimedAt: null,
      priorReviews: [],
      entity: {
        processId: 'company-request-comp1',
        companyName: 'Globex Corp',
        roleTitle: 'New company request',
        requestedCompanySlug: 'globex-corp',
        requestedCompanySizeBucket: 'large',
        requestedCompanyIndustry: 'Manufacturing',
      },
    };

    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('typing a query replaces the grouped view with matching results, each labeled by category', async () => {
      searchResultsMock = [searchHit, companyHit];
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.type(screen.getByLabelText('Search'), 'acme');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(await screen.findByText('Interview Review')).toBeInTheDocument();
      expect(screen.getByText('Create Company Request')).toBeInTheDocument();
      // The grouped view's own rows are gone while in search mode.
      expect(screen.queryByText('2 pending items')).not.toBeInTheDocument();
    });

    it('clearing the query restores the normal grouped queue view', async () => {
      searchResultsMock = [searchHit];
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      const searchInput = screen.getByLabelText('Search');
      await user.type(searchInput, 'acme');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await screen.findByText('Interview Review');

      await user.clear(searchInput);
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(await screen.findByText('2 pending items')).toBeInTheDocument();
      expect(screen.queryByText('Interview Review')).not.toBeInTheDocument();
    });

    it('a category filter alone (empty query) also searches', async () => {
      searchResultsMock = [companyHit];
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.selectOptions(screen.getByLabelText('Category'), 'create-company');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(await screen.findByText('Globex Corp')).toBeInTheDocument();
      expect(screen.getByText('Create Company Request')).toBeInTheDocument();
    });

    it('shows a distinct empty state for zero search matches', async () => {
      searchResultsMock = [];
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.type(screen.getByLabelText('Search'), 'nonexistent');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(await screen.findByText('No matches for this search.')).toBeInTheDocument();
    });

    it('approving a search result removes it from the results', async () => {
      searchResultsMock = [searchHit];
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ModerationPage />);
      await screen.findByText('Acme Corp · Engineer');

      await user.type(screen.getByLabelText('Search'), 'acme');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await screen.findByText('Interview Review');

      await user.click(screen.getByRole('button', { name: 'Approve' }));

      await waitFor(() =>
        expect(
          (global.fetch as jest.Mock).mock.calls.some(([url]: [string]) =>
            String(url).includes('/moderation/queue/q-round/approve'),
          ),
        ).toBe(true),
      );
      await waitFor(() => expect(screen.queryByText('Interview Review')).not.toBeInTheDocument());
    });
  });

  // GitHub issue #591 (Phase 42, D99) — staff has moderation:queue:read
  // only, no claim/approve/reject/flag/release permission at all.
  describe('role gating (staff)', () => {
    function mockFetchAsStaff() {
      global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/auth/admin/me') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'mod-staff', username: 'staff-account', role: 'staff' }),
          });
        }
        if (url.endsWith('/companies') && method === 'GET') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: companiesMock, total: companiesMock.length, page: 1, pageSize: 200 }) });
        }
        if (url.includes('/moderation/queue') && !url.includes('/moderation/queue/') && method === 'GET') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(queueGroups) });
        }
        throw new Error(`Unmocked fetch: ${method} ${url}`);
      }) as jest.Mock;
    }

    it('hides approve/reject/flag/claim/release but still shows the claim badge, and hides the Staff accounts link', async () => {
      mockFetchAsStaff();
      render(<ModerationPage />);

      await screen.findByText('Acme Corp · Engineer');
      await userEvent.setup().click(screen.getByRole('button', { name: /Acme Corp · Engineer/ }));

      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Flag' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
      // The other entry in this group is pre-claimed by 'other-mod' — the
      // badge is informational, not an action, so it still renders.
      expect(screen.getByText('Claimed by other-mod')).toBeInTheDocument();

      expect(screen.queryByRole('link', { name: 'Staff accounts' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View round-type field options' })).toBeInTheDocument();
    });
  });
});
