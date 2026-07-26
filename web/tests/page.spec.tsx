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

  // GitHub issue #357 (Phase 34) — every company row (search results and
  // quick-select alike) shows the identical "Browse reviews" / "View
  // profile" / "Write a review" action set; the company name itself is
  // plain text, not a click target.
  it('shows a homogeneous row (Browse reviews, View profile, Write a review) for each search result', async () => {
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
    const writeReviewLink = screen.getByRole('link', { name: 'Write a review' });
    expect(writeReviewLink).toHaveAttribute(
      'href',
      '/write-review?companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    // The company name is plain text, not a button — only "Browse reviews"
    // selects the company for step 2.
    expect(screen.queryByRole('button', { name: /Acme Corp/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browse reviews' }));
    expect(await screen.findByText(/Browse reviews for Acme Corp/)).toBeInTheDocument();
    // Step 2's header link reads plain "View profile" too — no parentheses,
    // matching the row above (homogeneous, per direct request).
    expect(screen.queryByText('(view profile)')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View profile' })).toHaveLength(2);
  });

  // The quick-select company rows, relocated here from the wizard's old
  // "Start a new draft" picker (which no longer exists — see write-review/page.tsx).
  describe('quick-select company rows', () => {
    it('lists every existing company as a homogeneous row, alongside the text search', async () => {
      mockFetchByRoute([
        { id: 'company-1', name: 'Amazon', slug: 'amazon', industry: null, sizeBucket: 'large' },
        { id: 'company-2', name: 'Walmart Tech', slug: 'walmart-tech', industry: null, sizeBucket: 'large' },
      ]);
      render(<SearchPage />);

      expect(await screen.findByText('Amazon')).toBeInTheDocument();
      expect(screen.getByText('Walmart Tech')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Browse reviews' })).toHaveLength(2);
      expect(screen.getAllByRole('link', { name: 'Write a review' })).toHaveLength(2);
    });

    it('selecting a quick-row company reveals step 2 for browsing its reviews', async () => {
      mockFetchByRoute([
        { id: 'company-1', name: 'Amazon', slug: 'amazon', industry: null, sizeBucket: 'large' },
      ]);
      const user = userEvent.setup();
      render(<SearchPage />);

      await user.click(await screen.findByRole('button', { name: 'Browse reviews' }));

      expect(await screen.findByText(/Browse reviews for Amazon/)).toBeInTheDocument();
    });

    it('does not show any quick rows when there are no companies yet', async () => {
      mockFetchByRoute([]);
      render(<SearchPage />);

      await waitFor(() => expect(screen.getByText('1. Find a company')).toBeInTheDocument());
      expect(screen.queryByText('Or pick one directly:')).not.toBeInTheDocument();
    });
  });
});
