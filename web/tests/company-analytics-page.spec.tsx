import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CompanyAnalyticsPage from '../src/app/companies/[slug]/analytics/page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-corp' }),
}));

const analytics = {
  companyId: 'company-1',
  roundTypes: [],
  recruiter: null,
  overall: null,
};

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    if (url.includes('/companies/by-slug/')) {
      return respond({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    }
    if (url.includes('/analytics')) return respond(analytics);
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

const populatedAnalytics = {
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

function mockFetchWith(body: typeof analytics) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (url.includes('/companies/by-slug/')) {
      return respond({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    }
    if (url.includes('/analytics')) return respond(body);
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('CompanyAnalyticsPage (Phase 15 issue #142: link back to the profile page)', () => {
  afterEach(() => {
    setLoggedInCookie(false);
  });

  it('links back to the company profile page by slug', async () => {
    mockFetch();
    render(<CompanyAnalyticsPage />);

    const backLink = await screen.findByRole('link', { name: 'Back to company profile' });
    expect(backLink).toHaveAttribute('href', '/companies/acme-corp');
  });
});

describe('CompanyAnalyticsPage anonymous visitor soft-gating (GitHub issue #226, Phase 21)', () => {
  afterEach(() => {
    setLoggedInCookie(false);
  });

  it('gates the entire analytics breakdown for an anonymous visitor', async () => {
    mockFetchWith(populatedAnalytics);
    render(<CompanyAnalyticsPage />);

    expect(
      await screen.findByText('Log in to see the full analytics breakdown for Acme Corp'),
    ).toBeInTheDocument();
    expect(screen.queryByText('4.20')).not.toBeInTheDocument();
    expect(screen.queryByText('Overall experience')).not.toBeInTheDocument();
  });

  it('shows the full breakdown when logged in', async () => {
    setLoggedInCookie(true);
    mockFetchWith(populatedAnalytics);
    render(<CompanyAnalyticsPage />);

    expect(await screen.findByText('4.20')).toBeInTheDocument();
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.queryByText(/Log in to see/)).not.toBeInTheDocument();
  });
});
