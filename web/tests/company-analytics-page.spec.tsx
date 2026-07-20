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

describe('CompanyAnalyticsPage (Phase 15 issue #142: link back to the profile page)', () => {
  it('links back to the company profile page by slug', async () => {
    mockFetch();
    render(<CompanyAnalyticsPage />);

    const backLink = await screen.findByRole('link', { name: 'Back to company profile' });
    expect(backLink).toHaveAttribute('href', '/companies/acme-corp');
  });
});
