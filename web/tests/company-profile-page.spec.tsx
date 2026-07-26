import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CompanyProfilePage from '../src/app/companies/[slug]/page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-corp' }),
}));

const company = {
  id: 'company-1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  industry: 'Fintech',
  sizeBucket: 'mid',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const analytics = {
  companyId: 'company-1',
  roundTypes: [
    {
      roundType: 'coding',
      sampleSize: 5,
      scores: { difficulty: 3.5, fluency: 4.0, clarity: 4.1, focus: null },
    },
  ],
  recruiter: null,
  overall: { sampleSize: 4, scores: { overallExperience: 4.2, wouldRecommendPct: 80 } },
};

function reviewsPage(page: number, total: number, items: unknown[]) {
  return { total, page, pageSize: 10, items };
}

// GitHub issue #347: reviews are grouped by submission, one collapsed
// item per group, expanding on click to reveal each round's full detail.
const oneReviewGroup = {
  processId: 'process-1',
  roleTitle: 'Backend Engineer',
  entries: [
    {
      id: 'review-1',
      createdAt: '2026-01-01T00:00:00Z',
      roundTitle: 'Technical Screen',
      roundType: 'coding',
      difficulty: 3,
      fluency: 4,
      clarity: 4,
      focus: 4,
      technicalDepth: null,
      freeText: 'Solid, well-run round.',
    },
  ],
};

function mockFetchByRoute(reviewsResponse: ReturnType<typeof reviewsPage>) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

    if (url.includes('/companies/by-slug/')) return respond(company);
    if (url.includes('/analytics')) return respond(analytics);
    if (url.includes('/reviews')) return respond(reviewsResponse);
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

function renderPage() {
  return render(<CompanyProfilePage />);
}

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('CompanyProfilePage (Phase 15 issue #141)', () => {
  afterEach(() => {
    setLoggedInCookie(false);
  });

  it('renders company header, aggregate scores, and reviews', async () => {
    mockFetchByRoute(reviewsPage(1, 1, [oneReviewGroup]));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText(/Fintech/)).toBeInTheDocument();
    expect(screen.getByText('4.20')).toBeInTheDocument(); // overall experience
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    // Round detail (including freeText) is collapsed by default (issue #347).
    expect(screen.queryByText('Solid, well-run round.', { exact: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /View details/ }));
    expect(screen.getByText('Solid, well-run round.', { exact: false })).toBeInTheDocument();
  });

  it('shows "Not enough reviews yet" when analytics has no overall data, not a blank section', async () => {
    mockFetchByRoute(reviewsPage(1, 0, []));
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (url.includes('/companies/by-slug/')) return respond(company);
      if (url.includes('/analytics')) return respond({ ...analytics, overall: null, roundTypes: [] });
      if (url.includes('/reviews')) return respond(reviewsPage(1, 0, []));
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    renderPage();

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getAllByText('Not enough reviews yet').length).toBeGreaterThan(0);
  });

  it('shows an explicit empty state when there are zero approved reviews', async () => {
    mockFetchByRoute(reviewsPage(1, 0, []));
    renderPage();

    expect(await screen.findByText(/No approved reviews yet/)).toBeInTheDocument();
  });

  it('paginates the reviews list when logged in', async () => {
    setLoggedInCookie(true);
    mockFetchByRoute(reviewsPage(1, 15, [oneReviewGroup]));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Page 1 of 2');
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).not.toBeDisabled();

    await user.click(nextButton);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.anything(),
      ),
    );
  });

  it('links to the full analytics dashboard by slug', async () => {
    mockFetchByRoute(reviewsPage(1, 1, [oneReviewGroup]));
    renderPage();

    const link = await screen.findByRole('link', { name: /Full analytics breakdown/ });
    expect(link).toHaveAttribute('href', '/companies/acme-corp/analytics');
  });

  describe('anonymous visitor soft-gating (GitHub issue #226, Phase 21)', () => {
    it('shows the overall-experience hook but gates the round-type breakdown', async () => {
      mockFetchByRoute(reviewsPage(1, 1, [oneReviewGroup]));
      renderPage();

      expect(await screen.findByText('4.20')).toBeInTheDocument(); // overall experience — the free hook
      expect(screen.getByText('Log in to see the full round-type breakdown')).toBeInTheDocument();
      expect(screen.queryByText('3.50')).not.toBeInTheDocument(); // round-type difficulty score
    });

    it('shows the first review group and the real total, gating the rest', async () => {
      const secondGroup = {
        processId: 'process-2',
        roleTitle: 'Staff Engineer',
        entries: [{ ...oneReviewGroup.entries[0], id: 'review-2', freeText: 'A second, gated review.' }],
      };
      mockFetchByRoute(reviewsPage(1, 2, [oneReviewGroup, secondGroup]));
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
      expect(screen.getByText('2 reviews')).toBeInTheDocument();
      expect(screen.getByText('Log in to see the other 1 review')).toBeInTheDocument();
      // Free-preview group's own content is expandable...
      await user.click(screen.getByRole('button', { name: /View details/ }));
      expect(screen.getByText('Solid, well-run round.', { exact: false })).toBeInTheDocument();
      // ...but the second group is gated entirely, never rendered at all.
      expect(screen.queryByText('Staff Engineer')).not.toBeInTheDocument();
      expect(screen.queryByText('A second, gated review.', { exact: false })).not.toBeInTheDocument();
    });

    it('gates pagination controls entirely when logged out', async () => {
      mockFetchByRoute(reviewsPage(1, 15, [oneReviewGroup]));
      renderPage();

      await screen.findByText(/Log in to see the other 14 reviews/);
      expect(screen.queryByText('Page 1 of 2')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    });

    it('shows the full round-type breakdown and all review groups when logged in', async () => {
      setLoggedInCookie(true);
      const secondGroup = {
        processId: 'process-2',
        roleTitle: 'Staff Engineer',
        entries: [{ ...oneReviewGroup.entries[0], id: 'review-2', freeText: 'A second, visible review.' }],
      };
      mockFetchByRoute(reviewsPage(1, 2, [oneReviewGroup, secondGroup]));
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByText('3.50')).toBeInTheDocument(); // round-type difficulty score
      expect(screen.getByText('Staff Engineer')).toBeInTheDocument();
      expect(screen.queryByText(/Log in to see/)).not.toBeInTheDocument();

      const detailButtons = screen.getAllByRole('button', { name: /View details/ });
      expect(detailButtons).toHaveLength(2);
      await user.click(detailButtons[1]);
      expect(screen.getByText('A second, visible review.', { exact: false })).toBeInTheDocument();
    });
  });
});
