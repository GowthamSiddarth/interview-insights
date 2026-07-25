import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MyReviewsPage from '../src/app/me/page';

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

function mockSubmissions(body: unknown) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/me/submissions')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

const roundRatingSubmission = [
  {
    processId: 'process-1',
    companyId: 'company-1',
    companyName: 'Acme Corp',
    companySlug: 'acme-corp',
    roleTitle: 'Senior Engineer',
    outcome: 'in_progress',
    createdAt: '2026-01-01T00:00:00.000Z',
    roundRatings: [
      {
        id: 'rating-1',
        roundId: 'round-1',
        roundTitle: 'Technical Screen',
        roundType: 'coding',
        status: 'approved',
        difficulty: 3,
        fluency: 4,
        clarity: 4,
        focus: 4,
        technicalDepth: null,
        freeText: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    recruiterRatings: [],
    overallReview: null,
  },
];

describe('MyReviewsPage (GitHub issue #149)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // GitHub issue #151's delete-account flow hard-navigates home (D32's
    // same reasoning as the verify-page redirect) — jsdom doesn't
    // implement real navigation, so replace window.location with a stub
    // whose href setter tests can assert on.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    setLoggedInCookie(false);
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('prompts to log in when there is no candidate session', async () => {
    setLoggedInCookie(false);
    render(<MyReviewsPage />);

    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('shows an empty state when the candidate has no submissions', async () => {
    setLoggedInCookie(true);
    mockSubmissions([]);
    render(<MyReviewsPage />);

    expect(await screen.findByText("You haven't submitted anything yet.")).toBeInTheDocument();
  });

  it('groups a submission under its process and shows every status, including pending/rejected', async () => {
    setLoggedInCookie(true);
    mockSubmissions([
      {
        processId: 'process-1',
        companyId: 'company-1',
        companyName: 'Acme Corp',
        companySlug: 'acme-corp',
        roleTitle: 'Senior Engineer',
        outcome: 'in_progress',
        createdAt: '2026-01-01T00:00:00.000Z',
        roundRatings: [
          {
            id: 'rating-1',
            roundId: 'round-1',
            roundTitle: 'Technical Screen',
            roundType: 'coding',
            status: 'approved',
            difficulty: 3,
            fluency: 4,
            clarity: 4,
            focus: 4,
            technicalDepth: null,
            freeText: null,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        recruiterRatings: [
          {
            id: 'recruiter-rating-1',
            recruiterInteractionId: 'interaction-1',
            status: 'rejected',
            approachability: 5,
            responseTime: 4,
            timeliness: 5,
            communicationQuality: 5,
            freeText: null,
            createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
        overallReview: {
          id: 'overall-1',
          status: 'pending',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: null,
          createdAt: '2026-01-04T00:00:00.000Z',
        },
      },
    ]);
    render(<MyReviewsPage />);

    expect(await screen.findByText('Acme Corp — Senior Engineer')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View company profile' }),
    ).toHaveAttribute('href', '/companies/acme-corp');
  });

  it("shows a process with no ratings yet as a distinct 'nothing submitted' note", async () => {
    setLoggedInCookie(true);
    mockSubmissions([
      {
        processId: 'process-1',
        companyId: 'company-1',
        companyName: 'Acme Corp',
        companySlug: 'acme-corp',
        roleTitle: 'Engineer',
        outcome: 'in_progress',
        createdAt: '2026-01-01T00:00:00.000Z',
        roundRatings: [],
        recruiterRatings: [],
        overallReview: null,
      },
    ]);
    render(<MyReviewsPage />);

    expect(await screen.findByText('No ratings submitted for this process yet.')).toBeInTheDocument();
  });

  // GitHub issue #260: an empty process gets a delete affordance — found
  // live while verifying issue #247's fields, an abandoned mid-wizard
  // process had no cleanup path at all.
  const emptyProcessSubmission = [
    {
      processId: 'process-1',
      companyId: 'company-1',
      companyName: 'Acme Corp',
      companySlug: 'acme-corp',
      roleTitle: 'Engineer',
      outcome: 'in_progress',
      createdAt: '2026-01-01T00:00:00.000Z',
      roundRatings: [],
      recruiterRatings: [],
      overallReview: null,
    },
  ];

  it('deletes an empty process after confirming, then reloads the list', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let deleteCalled = false;

    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/submissions')) {
        const body = deleteCalled ? [] : emptyProcessSubmission;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      }
      if (url.endsWith('/processes/process-1') && init?.method === 'DELETE') {
        deleteCalled = true;
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
      }
      throw new Error(`Unmocked fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as jest.Mock;

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete process' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(deleteCalled).toBe(true));
    confirmSpy.mockRestore();
  });

  it('does not delete the process when the confirmation is declined', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mockSubmissions(emptyProcessSubmission);

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete process' }));

    expect(confirmSpy).toHaveBeenCalled();
    const fetchMock = global.fetch as jest.Mock;
    expect(
      fetchMock.mock.calls.some((c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false);
    confirmSpy.mockRestore();
  });

  // GitHub issue #150: an edit resets the item to pending — this test
  // proves the client sends a PATCH to the right URL and reloads the list
  // afterward (which is why the list mock has to answer /me/submissions
  // twice: once on initial load, once after save()'s onChanged() reload).
  it('edits a round rating: PATCHes the right URL, then reloads the list', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/submissions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(roundRatingSubmission) });
      }
      if (url.includes('/rounds/round-1/ratings/rating-1') && init?.method === 'PATCH') {
        patchCalls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'rating-1', status: 'pending' }),
        });
      }
      throw new Error(`Unmocked fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as jest.Mock;

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0].url).toContain('/rounds/round-1/ratings/rating-1');
    expect(patchCalls[0].body).toMatchObject({ difficulty: 3, fluency: 4 });
    // The list is refetched after a successful edit (fetch called for
    // /me/submissions twice: initial load + post-save reload).
    const fetchMock = global.fetch as jest.Mock;
    const submissionsCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).endsWith('/me/submissions'),
    );
    expect(submissionsCalls).toHaveLength(2);
  });

  it('deletes a round rating after confirming, then reloads the list', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let deleteCalled = false;

    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/submissions')) {
        const body = deleteCalled ? [] : roundRatingSubmission;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      }
      if (url.includes('/rounds/round-1/ratings/rating-1') && init?.method === 'DELETE') {
        deleteCalled = true;
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
      }
      throw new Error(`Unmocked fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as jest.Mock;

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(deleteCalled).toBe(true));
    confirmSpy.mockRestore();
  });

  it('does not delete when the confirmation is declined', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mockSubmissions(roundRatingSubmission);

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalled();
    const fetchMock = global.fetch as jest.Mock;
    expect(
      fetchMock.mock.calls.some((c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false);
    confirmSpy.mockRestore();
  });

  // GitHub issue #151: the "Danger zone" account-erasure control.
  it('shows a Danger zone with a Delete my account control', async () => {
    setLoggedInCookie(true);
    mockSubmissions([]);
    render(<MyReviewsPage />);

    expect(await screen.findByText('Danger zone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

  it('erases the account and hard-navigates home after confirming', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let deleteMeCalled = false;

    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/submissions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.endsWith('/me') && init?.method === 'DELETE') {
        deleteMeCalled = true;
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
      }
      throw new Error(`Unmocked fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as jest.Mock;

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(deleteMeCalled).toBe(true));
    await waitFor(() => expect(window.location.href).toBe('/'));
    confirmSpy.mockRestore();
  });

  it('does not erase the account when the confirmation is declined', async () => {
    setLoggedInCookie(true);
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mockSubmissions([]);

    render(<MyReviewsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(window.location.href).toBe('');
    const fetchMock = global.fetch as jest.Mock;
    expect(
      fetchMock.mock.calls.some(
        (c: unknown[]) =>
          String(c[0]).endsWith('/me') && (c[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(false);
    confirmSpy.mockRestore();
  });
});
