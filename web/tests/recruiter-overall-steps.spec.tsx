import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

// Route-based fetch mock covering the whole wizard flow up through the two
// Phase 14 steps (recruiter experience, overall review). Each entry returns
// the minimal body the page actually reads.
function mockFetchByRoute() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies') && method === 'GET') {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/companies/company-1/processes')) {
      return respond({ id: 'process-1', roleTitle: 'Engineer', rounds: [] });
    }
    if (url.endsWith('/processes/process-1/rounds')) {
      return respond({ id: 'round-1', title: 'Screen' });
    }
    if (url.endsWith('/rounds/round-1/ratings') && method === 'POST') {
      return respond({ id: 'rating-1', status: 'pending' });
    }
    if (url.endsWith('/rounds/round-1/ratings')) {
      return respond([]);
    }
    if (url.endsWith('/processes/process-1/recruiter-interactions')) {
      return respond({ id: 'interaction-1', processId: 'process-1', recruiterId: 'recruiter-1' });
    }
    if (url.endsWith('/recruiter-interactions/interaction-1/ratings')) {
      return respond({ id: 'recruiter-rating-1', status: 'pending' });
    }
    if (url.endsWith('/processes/process-1/overall-review')) {
      return respond({ id: 'overall-review-1', status: 'pending' });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

// Drives the wizard up to the point where a round exists — the gate for
// both new sections.
async function walkToRound(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
  await user.type(await screen.findByLabelText(/Role title/), 'Engineer');
  await user.click(screen.getByRole('button', { name: 'Create process' }));
  await user.type(await screen.findByLabelText('Title'), 'Screen');
  await user.click(screen.getByRole('button', { name: 'Add round' }));
  await screen.findByText(/Round "Screen" added/);
}

describe('Wizard: recruiter experience + overall review steps (Phase 14 issue #127)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    document.cookie = 'candidate_logged_in=1';
  });

  it('shows both new sections once a round exists, not before', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    expect(screen.queryByText('5. Recruiter experience')).not.toBeInTheDocument();
    expect(screen.queryByText('6. Overall review')).not.toBeInTheDocument();

    await walkToRound(user);

    expect(screen.getByText('5. Recruiter experience')).toBeInTheDocument();
    expect(screen.getByText('6. Overall review')).toBeInTheDocument();
  });

  it('submits recruiter interaction + rating and shows the pending confirmation', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await walkToRound(user);

    await user.type(screen.getByLabelText(/Recruiter name or email/), 'jane@acme.example');
    await user.click(screen.getByRole('button', { name: 'Submit recruiter rating' }));

    expect(await screen.findByText(/Recruiter rating submitted/)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    // The interaction was created first, then the rating against it.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/processes/process-1/recruiter-interactions'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/recruiter-interactions/interaction-1/ratings'),
      expect.objectContaining({ method: 'POST' }),
    );
    // The form is gone — one recruiter rating per interaction in this flow.
    expect(
      screen.queryByRole('button', { name: 'Submit recruiter rating' }),
    ).not.toBeInTheDocument();
  });

  it('submits the overall review and shows the pending confirmation', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await walkToRound(user);

    await user.click(screen.getByLabelText(/recommend interviewing here/));
    await user.click(screen.getByRole('button', { name: 'Submit overall review' }));

    expect(await screen.findByText(/Overall review submitted/)).toBeInTheDocument();
    const overallCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]: [string, RequestInit?]) =>
        String(url).endsWith('/processes/process-1/overall-review') && init?.method === 'POST',
    ) as [string, RequestInit] | undefined;
    expect(overallCall).toBeDefined();
    expect(JSON.parse(String(overallCall?.[1].body))).toMatchObject({
      wouldRecommend: true,
    });
    // One overall review per process — the form disappears after submission.
    expect(screen.queryByRole('button', { name: 'Submit overall review' })).not.toBeInTheDocument();
  });
});
