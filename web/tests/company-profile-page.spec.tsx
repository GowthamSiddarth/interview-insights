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
      expect(screen.getByText('Log in to filter and see the other 1 review')).toBeInTheDocument();
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

      await screen.findByText(/Log in to filter and see the other 14 reviews/);
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

  // GitHub issue #425 (Phase 38) — found via live verification on the
  // Gerhold - Schneider company profile: the page-fetch effect used to skip
  // fetching whenever `page === 1`, which also fired on a Previous click
  // returning to page 1, leaving the reviews list stuck on the last-fetched
  // page instead of refetching/redisplaying page 1's own reviews.
  describe('pagination (GitHub issue #425)', () => {
    it('refetches and redisplays page 1 correctly after paging forward then back with Previous', async () => {
      setLoggedInCookie(true);
      const page1Group = { ...oneReviewGroup, processId: 'process-1', roleTitle: 'Backend Engineer' };
      const page2Group = { ...oneReviewGroup, processId: 'process-2', roleTitle: 'Staff Engineer' };
      global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const respond = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        if (url.includes('/companies/by-slug/')) return respond(company);
        if (url.includes('/analytics')) return respond(analytics);
        if (url.includes('page=2')) return respond(reviewsPage(2, 15, [page2Group]));
        if (url.includes('/reviews')) return respond(reviewsPage(1, 15, [page1Group]));
        throw new Error(`Unmocked fetch: ${url}`);
      }) as jest.Mock;

      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Backend Engineer');
      await screen.findByText('Page 1 of 2');

      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('Page 2 of 2');
      expect(await screen.findByText('Staff Engineer')).toBeInTheDocument();
      expect(screen.queryByText('Backend Engineer')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Previous' }));

      await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument());
      expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
      expect(screen.queryByText('Staff Engineer')).not.toBeInTheDocument();
    });

  });

  // GitHub issue #424 (Phase 38) — filtering merged directly into the
  // Reviews section (no separate "Browse reviews" section/button), gated
  // behind login the same as the rest of that section's content.
  describe('Reviews section: merged filtering', () => {
    it('does not show the filter form when logged out', async () => {
      const secondGroup = { ...oneReviewGroup, processId: 'process-2', roleTitle: 'Staff Engineer' };
      mockFetchByRoute(reviewsPage(1, 2, [oneReviewGroup, secondGroup]));
      renderPage();

      await screen.findByText('Backend Engineer');
      expect(screen.queryByLabelText('Role title')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Search reviews' })).not.toBeInTheDocument();
    });

    it('filters reviews in place of the default list when logged in, and Clear filters restores it', async () => {
      setLoggedInCookie(true);
      const secondGroup = { ...oneReviewGroup, processId: 'process-2', roleTitle: 'Staff Engineer' };
      global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const respond = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        if (url.includes('/companies/by-slug/')) return respond(company);
        if (url.includes('/analytics')) return respond(analytics);
        if (url.includes('/search/reviews')) {
          return respond([
            {
              id: 'search-result-1',
              companyId: 'company-1',
              roleTitle: 'Backend Engineer',
              roundType: 'coding',
              freeText: 'Great round',
              createdAt: '2026-01-01T00:00:00Z',
              difficulty: 3,
              fluency: 4,
              clarity: 4,
              focus: 4,
            },
          ]);
        }
        if (url.includes('/reviews')) return respond(reviewsPage(1, 2, [oneReviewGroup, secondGroup]));
        throw new Error(`Unmocked fetch: ${url}`);
      }) as jest.Mock;

      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Staff Engineer'); // default grouped list, pre-filter

      await user.type(screen.getByLabelText('Role title'), 'Backend');
      await user.click(screen.getByRole('button', { name: 'Search reviews' }));

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/search/reviews?'),
          expect.anything(),
        ),
      );
      const searchCall = (global.fetch as jest.Mock).mock.calls.find(([u]) =>
        String(u).includes('/search/reviews'),
      );
      expect(String(searchCall?.[0])).toContain('companyId=company-1');
      expect(String(searchCall?.[0])).toContain('roleTitle=Backend');

      expect(await screen.findByText('Backend Engineer — Coding')).toBeInTheDocument();
      expect(screen.getByText('Great round')).toBeInTheDocument();
      // The default grouped/paginated list is replaced while a filter is active.
      expect(screen.queryByText('Staff Engineer')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear filters' }));

      expect(await screen.findByText('Staff Engineer')).toBeInTheDocument();
      expect(screen.queryByText('Backend Engineer — Coding')).not.toBeInTheDocument();
    });

    // GitHub issue #429 (Phase 38) — the filter form was rendering after the
    // always-visible first review (sandwiched between it and the gated
    // rest), not directly after the section's header/count as intended.
    it('renders the filter form before the first review, not after it', async () => {
      setLoggedInCookie(true);
      const secondGroup = { ...oneReviewGroup, processId: 'process-2', roleTitle: 'Staff Engineer' };
      mockFetchByRoute(reviewsPage(1, 2, [oneReviewGroup, secondGroup]));
      renderPage();

      const roleTitleInput = await screen.findByLabelText('Role title');
      const firstReview = screen.getByText('Backend Engineer');

      // DOCUMENT_POSITION_FOLLOWING on firstReview relative to roleTitleInput
      // means roleTitleInput comes first in document order.
      const position = roleTitleInput.compareDocumentPosition(firstReview);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
