import { render, screen, within } from './test-utils';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/write-review/page';

// The wizard now receives its company via query params instead of its own
// picker (a "Write a review" link from the search/landing page).
jest.mock('next/navigation', () => {
  const params = new URLSearchParams(
    'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
  );
  return {
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => params,
  };
});

const fieldOptionsResponse = {
  coding: { fields: [] },
  system_design: { fields: [] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
  case_study: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  other: { fields: [] },
};

function mockFetchByRoute() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const respond = (body: unknown, status = 200) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies') && method === 'GET') {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/round-types/field-options')) {
      return respond(fieldOptionsResponse);
    }
    if (url.includes('/processes/bulk') && method === 'POST') {
      return respond({ id: 'process-1' });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('Non-blocking recruiter-touchpoint reminders on submit (GitHub issue #307)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
  });

  async function openValidDraft(user: ReturnType<typeof userEvent.setup>) {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');
    // GitHub issue #319 — adding a round is only reachable via the
    // Next-button modal now (the sidebar's direct control is gone).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.selectOptions(within(dialog).getByLabelText('Round type'), 'coding');
    await user.click(within(dialog).getByRole('button', { name: 'Add new round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Screen');
    await user.click(screen.getByText('Review & Submit'));
  }

  it('reminds about both missing touchpoints when neither exists, without blocking submission', async () => {
    const user = userEvent.setup();
    await openValidDraft(user);

    expect(await screen.findByText('Before you submit — was this intentional?')).toBeInTheDocument();
    expect(
      screen.getByText("You haven't added a pre-interview recruiter touchpoint."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You haven't added a post-interview recruiter touchpoint."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit anyway' }));
    expect(await screen.findByText('Submitted!')).toBeInTheDocument();
  });

  it('does not remind at all once both touchpoints exist', async () => {
    const user = userEvent.setup();
    await openValidDraft(user);
    await screen.findByText('Before you submit — was this intentional?');

    await user.click(screen.getByRole('button', { name: 'Process details' }));
    await user.click(screen.getByRole('button', { name: '+ Recruiter (pre-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'jane@acme.example');
    await user.click(screen.getByRole('button', { name: 'Process details' }));
    await user.click(screen.getByRole('button', { name: '+ Recruiter (post-interview)' }));
    await user.type(await screen.findByLabelText(/Recruiter name or email/), 'bob@acme.example');

    await user.click(screen.getByText('Review & Submit'));

    expect(
      screen.queryByText('Before you submit — was this intentional?'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('"+ Add now" creates the missing touchpoint with the right timing and jumps straight into editing it', async () => {
    const user = userEvent.setup();
    await openValidDraft(user);
    await screen.findByText('Before you submit — was this intentional?');

    const addNowButtons = screen.getAllByRole('button', { name: '+ Add now' });
    // First reminder listed is the missing pre-interview one.
    await user.click(addNowButtons[0]);

    expect(await screen.findByRole('heading', { name: 'Recruiter touchpoint' })).toBeInTheDocument();
    expect(screen.getByText('Before my interview')).toBeInTheDocument();
  });
});
