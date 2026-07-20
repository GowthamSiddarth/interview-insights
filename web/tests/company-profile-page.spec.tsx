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
      scores: { difficulty: 3.5, fairness: 4.1, communicationFluency: 4.0, attentiveness: null, biasSignal: null },
    },
  ],
  recruiter: null,
  overall: { sampleSize: 4, scores: { overallExperience: 4.2, wouldRecommendPct: 80 } },
};

function reviewsPage(page: number, total: number, items: unknown[]) {
  return { total, page, pageSize: 10, items };
}

const oneReview = {
  id: 'review-1',
  createdAt: '2026-01-01T00:00:00Z',
  roundTitle: 'Technical Screen',
  roundType: 'coding',
  roleTitle: 'Backend Engineer',
  difficulty: 3,
  fairness: 4,
  communicationFluency: 4,
  attentiveness: 4,
  biasSignal: 5,
  technicalDepth: null,
  freeText: 'Solid, well-run round.',
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

describe('CompanyProfilePage (Phase 15 issue #141)', () => {
  it('renders company header, aggregate scores, and reviews', async () => {
    mockFetchByRoute(reviewsPage(1, 1, [oneReview]));
    renderPage();

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText(/Fintech/)).toBeInTheDocument();
    expect(screen.getByText('4.20')).toBeInTheDocument(); // overall experience
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

  it('paginates the reviews list', async () => {
    mockFetchByRoute(reviewsPage(1, 15, [oneReview]));
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
    mockFetchByRoute(reviewsPage(1, 1, [oneReview]));
    renderPage();

    const link = await screen.findByRole('link', { name: /Full analytics breakdown/ });
    expect(link).toHaveAttribute('href', '/companies/acme-corp/analytics');
  });
});
