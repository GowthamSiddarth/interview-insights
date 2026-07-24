import { render, screen } from '@testing-library/react';
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

describe('MyReviewsPage (GitHub issue #149)', () => {
  afterEach(() => {
    setLoggedInCookie(false);
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
            fairness: 4,
            communicationFluency: 4,
            attentiveness: 4,
            biasSignal: 5,
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
});
