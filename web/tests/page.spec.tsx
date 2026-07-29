import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SearchPage from '../src/app/page';

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

function mockFetchByRoute(companies: unknown[] = []) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    if (url.endsWith('/companies/top')) return respond(companies);
    if (url.includes('/search/companies')) return respond([]);
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// The landing page — searching/browsing reviews is the primary verb here
// now, not writing one (GitHub issue: swap landing page with search page).
describe('SearchPage (the landing page, now at /)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    setLoggedInCookie(false);
  });

  it('shows an explicit empty state — not a blank list — when a company search matches nothing', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (body: unknown) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (url.endsWith('/companies/top')) return respond([]);
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
      if (url.endsWith('/companies/top')) {
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
      if (url.endsWith('/companies/top')) return respond([]);
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

  // The quick-select company buttons — deliberately simple (plain,
  // name-only buttons), unlike the CompanyResultRow shape typed search
  // results use. GitHub issue #357 originally applied the homogeneous row
  // shape here too, but the project owner asked for it to be reverted:
  // the "Or pick one directly" quick-select list is meant to be a fast,
  // low-noise shortcut, and giving every company its own 3-action row
  // made an already-long company list read as redundant/repetitive.
  describe('quick-select company buttons', () => {
    it('lists every existing company as a plain button, alongside the text search', async () => {
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

  // GitHub issue #360 (Phase 34) — a search-failure-triggered path to
  // requesting a new company, unreachable any other way.
  describe('search-failure "request a new company" flow', () => {
    async function searchWithNoResults(user: ReturnType<typeof userEvent.setup>) {
      render(<SearchPage />);
      await user.type(screen.getByPlaceholderText('Company name'), 'Meta');
      await user.click(screen.getByRole('button', { name: 'Search' }));
      await screen.findByText('No companies match "Meta".');
    }

    it('never shows the create-company-request section on load, only after a failed search plus its own button', async () => {
      render(<SearchPage />);
      await waitFor(() => expect(screen.getByText('1. Find a company')).toBeInTheDocument());
      expect(screen.queryByText('Request a new company')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Want to file a create company request?' }),
      ).not.toBeInTheDocument();
    });

    it('shows the button only once a search has zero results, and reveals the section on click', async () => {
      const user = userEvent.setup();
      await searchWithNoResults(user);

      const button = screen.getByRole('button', { name: 'Want to file a create company request?' });
      expect(screen.queryByText('Request a new company')).not.toBeInTheDocument();

      await user.click(button);

      expect(await screen.findByText('Request a new company')).toBeInTheDocument();
    });

    it('shows the login-gate prompt instead of the form when logged out', async () => {
      setLoggedInCookie(false);
      const user = userEvent.setup();
      await searchWithNoResults(user);
      await user.click(screen.getByRole('button', { name: 'Want to file a create company request?' }));

      await screen.findByText('Request a new company');
      expect(screen.getByRole('link', { name: 'Log in to unlock' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    });

    // GitHub issue #372 (Phase 35) — a successful creation no longer
    // redirects anywhere (the created company is pending review, not
    // usable yet, issue #369); it shows a plain confirmation instead.
    async function createCompany(user: ReturnType<typeof userEvent.setup>) {
      setLoggedInCookie(true);
      global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const respond = (body: unknown) =>
          Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        if (url.endsWith('/companies/top') && method === 'GET') return respond([]);
        if (url.includes('/search/companies')) return respond([]);
        if (url.endsWith('/companies') && method === 'POST') {
          return respond({ id: 'new-co', name: 'Meta', slug: 'meta', sizeBucket: 'enterprise' });
        }
        throw new Error(`Unmocked fetch: ${method} ${url}`);
      }) as jest.Mock;

      await searchWithNoResults(user);
      await user.click(screen.getByRole('button', { name: 'Want to file a create company request?' }));
      await screen.findByText('Request a new company');

      await user.type(screen.getByLabelText('Name'), 'Meta');
      await user.type(screen.getByLabelText('Slug'), 'meta');
      await user.click(screen.getByRole('button', { name: 'Create company' }));
    }

    it('shows a confirmation modal and does not navigate anywhere', async () => {
      const user = userEvent.setup();
      await createCompany(user);

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('A create company request has been submitted.')).toBeInTheDocument();
      // Still on the landing page — the create-company-request section
      // (and therefore the page itself) is untouched behind the modal.
      expect(screen.getByText('Interview Insights')).toBeInTheDocument();
    });

    it('the OK button dismisses the modal and collapses the request section', async () => {
      const user = userEvent.setup();
      await createCompany(user);
      await screen.findByRole('dialog');

      await user.click(screen.getByRole('button', { name: 'OK' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Request a new company')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Want to file a create company request?' }),
      ).toBeInTheDocument();
    });

    it('the corner close button dismisses the modal identically', async () => {
      const user = userEvent.setup();
      await createCompany(user);
      await screen.findByRole('dialog');

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByText('Request a new company')).not.toBeInTheDocument();
    });
  });
});
