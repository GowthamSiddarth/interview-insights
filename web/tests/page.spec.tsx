import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SearchPage from '../src/app/page';

function mockFetchByRoute(companies: unknown[] = []) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    if (url.endsWith('/companies')) return respond(companies);
    if (url.includes('/search/companies')) return respond([]);
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// The landing page — searching/browsing reviews is the primary verb here
// now, not writing one (GitHub issue: swap landing page with search page).
describe('SearchPage (the landing page, now at /)', () => {
  beforeEach(() => {
    mockFetchByRoute();
  });

  it('shows an explicit empty state — not a blank list — when a company search matches nothing', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (body: unknown) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (url.endsWith('/companies')) return respond([]);
      if (url.includes('/search/companies')) return respond([]);
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<SearchPage />);

    await user.type(screen.getByPlaceholderText('Company name'), 'Nonexistent Co');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(screen.getByText('No companies match "Nonexistent Co".')).toBeInTheDocument(),
    );
  });

  it('shows a distinct loading indicator while a search is in flight (GitHub issue #61)', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/companies')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<SearchPage />);

    await user.type(screen.getByPlaceholderText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Before the fetch resolves: a loading indicator, not silence and not
    // an empty state — those would be indistinguishable from "haven't
    // searched yet" or "confirmed zero results".
    await waitFor(() => expect(screen.getByText('Searching…')).toBeInTheDocument());
    expect(screen.queryByText(/No companies match/)).not.toBeInTheDocument();

    resolveFetch({ ok: true, json: () => Promise.resolve([]) });

    await waitFor(() => expect(screen.getByText('No companies match "Acme".')).toBeInTheDocument());
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });

  it('links each company result to its public profile page, and to writing a review for it (Phase 15 issue #142)', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (body: unknown) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (url.endsWith('/companies')) return respond([]);
      if (url.includes('/search/companies')) {
        return respond([
          { id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', industry: null, sizeBucket: 'mid' },
        ]);
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<SearchPage />);

    await user.type(screen.getByPlaceholderText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const profileLink = await screen.findByRole('link', { name: 'View profile' });
    expect(profileLink).toHaveAttribute('href', '/companies/acme-corp');

    // Selecting the company for step 2 surfaces a profile link and a
    // "Write a review" link in its header, distinct from the select button.
    await user.click(screen.getByRole('button', { name: /Acme Corp/ }));
    const headerProfileLink = await screen.findByRole('link', { name: '(view profile)' });
    expect(headerProfileLink).toHaveAttribute('href', '/companies/acme-corp');
    const writeReviewLink = screen.getByRole('link', { name: 'Write a review' });
    expect(writeReviewLink).toHaveAttribute(
      'href',
      '/write-review?companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
  });

  // The quick-select company buttons, relocated here from the wizard's old
  // "Start a new draft" picker (which no longer exists — see search/page.tsx).
  describe('quick-select company buttons', () => {
    it('lists every existing company as a button, alongside the text search', async () => {
      mockFetchByRoute([
        { id: 'company-1', name: 'Amazon', slug: 'amazon', industry: null, sizeBucket: 'large' },
        { id: 'company-2', name: 'Walmart Tech', slug: 'walmart-tech', industry: null, sizeBucket: 'large' },
      ]);
      render(<SearchPage />);

      expect(await screen.findByRole('button', { name: 'Amazon' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Walmart Tech' })).toBeInTheDocument();
    });

    it('selecting a quick-button company reveals step 2 for browsing its reviews', async () => {
      mockFetchByRoute([
        { id: 'company-1', name: 'Amazon', slug: 'amazon', industry: null, sizeBucket: 'large' },
      ]);
      const user = userEvent.setup();
      render(<SearchPage />);

      await user.click(await screen.findByRole('button', { name: 'Amazon' }));

      expect(await screen.findByText(/Browse reviews for Amazon/)).toBeInTheDocument();
    });

    it('does not show any quick buttons when there are no companies yet', async () => {
      mockFetchByRoute([]);
      render(<SearchPage />);

      await waitFor(() => expect(screen.getByText('1. Find a company')).toBeInTheDocument());
      expect(screen.queryByText('Or pick one directly:')).not.toBeInTheDocument();
    });
  });
});
