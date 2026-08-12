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
      scores: { difficulty: 3.5, fluency: 4.0, clarity: 4.1, focus: null },
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
    // GitHub issue #619 — round-type difficulty moved into the
    // DifficultyBar magnitude chart, which formats to 1 decimal (a
    // chart label), not ScoreDisplay/StatTile's 2 (a dense grid).
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.queryByText(/Log in to see/)).not.toBeInTheDocument();
  });

  // GitHub issue #619 — a round type having enough samples overall
  // doesn't guarantee every individual metric (here: difficulty
  // itself) clears the shrinkage floor on its own. Caught by `tsc`
  // during this issue's own build (RoundTypeAnalytics.scores.difficulty
  // is `number | null`) before it could ship as a runtime crash.
  it('renders an empty difficulty bar (never a zero-width one) when a round type has no difficulty score yet', async () => {
    setLoggedInCookie(true);
    mockFetchWith({
      ...populatedAnalytics,
      roundTypes: [
        {
          roundType: 'coding',
          sampleSize: 5,
          scores: { difficulty: null, fluency: 4.0, clarity: 4.1, focus: 3.9 },
        },
      ],
    });
    render(<CompanyAnalyticsPage />);

    // "Coding" legitimately appears twice (the bar's own label and the
    // per-round-type heading below it) — findAllByText, not findByText.
    expect(await screen.findAllByText('Coding')).toHaveLength(2);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
