import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WizardPage from '../src/app/write-review/page';

// The wizard now always receives its company or an exact draft via query
// params (a "Write a review" link from the search/landing page, a company
// profile page, or "Resume" on /drafts) — it never has its own picker or
// create-company form. A stable module-level instance so useSearchParams()
// returns the same reference across re-renders, matching real Next.js
// (a fresh object every render would re-trigger the auto-start effect).
const mockSearchParams = {
  current: new URLSearchParams('companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp'),
};
const mockRouterReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => mockRouterReplace(...args), push: jest.fn() }),
  useSearchParams: () => mockSearchParams.current,
}));

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    if (url.endsWith('/round-types/field-options')) return respond({});
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('WizardPage (the write-a-review flow, now at /write-review)', () => {
  beforeEach(() => {
    mockFetch();
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
    mockSearchParams.current = new URLSearchParams(
      'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    mockRouterReplace.mockClear();
  });

  it('auto-starts a draft from the company carried in query params, and strips the params from the URL', async () => {
    render(<WizardPage />);

    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenCalledWith('/write-review');
  });

  it('"Back to my drafts" is a real link to /drafts, not an inline list', async () => {
    render(<WizardPage />);

    await screen.findByRole('heading', { name: 'Acme Corp' });
    expect(screen.getByRole('link', { name: 'Back to my drafts' })).toHaveAttribute(
      'href',
      '/drafts',
    );
  });

  it('resumes an existing draft for the same company instead of creating a duplicate, on a later visit', async () => {
    const user = userEvent.setup();
    render(<WizardPage />);

    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Senior Engineer');

    // Simulate leaving and re-arriving via another "Write a review" click
    // for the same company (e.g. the candidate navigated away and came
    // back) — this must resume the existing draft, not silently create a
    // second one.
    cleanup();
    mockSearchParams.current = new URLSearchParams(
      'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    render(<WizardPage />);

    expect(await screen.findByDisplayValue('Senior Engineer')).toBeInTheDocument();
  });

  it('resumes an exact draft by draftId (the /drafts page\'s "Resume" mechanism)', async () => {
    const user = userEvent.setup();
    render(<WizardPage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');

    cleanup();
    // Look up the real draft id the way /drafts would (localStorage), then
    // arrive via draftId instead of companyId.
    const stored = JSON.parse(window.localStorage.getItem('interview-insights:drafts:v1') ?? '{}') as Record<
      string,
      { id: string }
    >;
    const draftId = Object.keys(stored)[0];
    mockSearchParams.current = new URLSearchParams(`draftId=${draftId}`);
    render(<WizardPage />);

    expect(await screen.findByDisplayValue('Backend Engineer')).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenCalledWith('/write-review');
  });

  it('redirects home when visited with neither a company nor a draftId', async () => {
    mockSearchParams.current = new URLSearchParams();
    render(<WizardPage />);

    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect home once the company params are stripped from the URL after auto-starting', async () => {
    const { rerender } = render(<WizardPage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });
    expect(mockRouterReplace).toHaveBeenCalledWith('/write-review');
    mockRouterReplace.mockClear();

    // Simulate the URL actually updating to what router.replace('/write-review')
    // set it to (empty params) and the component re-rendering as a result —
    // this must not be mistaken for "arrived with no context" and bounced home.
    mockSearchParams.current = new URLSearchParams();
    rerender(<WizardPage />);

    expect(mockRouterReplace).not.toHaveBeenCalledWith('/');
    expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
  });

  it('shows the "Write a review" heading', async () => {
    render(<WizardPage />);
    expect(await screen.findByText('Write a review')).toBeInTheDocument();
  });
});
