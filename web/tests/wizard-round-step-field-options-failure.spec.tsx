import { render, screen, within } from './test-utils';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/write-review/page';

// GitHub issue #817 (Phase 56) — a failed GET /round-types/field-options
// used to silently drop every round-type-specific field with no
// indication why (fields.length === 0 either way, same as a round type
// that genuinely has no fields). This proves the fix: an explicit inline
// warning with a retry, not a silently incomplete round.
const mockSearchParams = { current: new URLSearchParams('companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp') };
const mockRouterReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => mockRouterReplace(...args), push: jest.fn() }),
  useSearchParams: () => mockSearchParams.current,
}));

const fieldOptionsResponse = {
  tech_screening: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  coding: {
    fields: [{ key: 'problemAlgorithms', kind: 'controlled-multi', options: ['DFS', 'BFS'] }],
  },
  system_design: { fields: [] },
  case_study: { fields: [] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
  other: { fields: [{ key: 'notes', kind: 'text' }] },
};

function mockFetchByRoute(fieldOptionsShouldFail: boolean) {
  let fieldOptionsCallCount = 0;
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies')) {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/round-types/field-options')) {
      fieldOptionsCallCount += 1;
      // Fails only the first call, so a retry can succeed.
      if (fieldOptionsShouldFail && fieldOptionsCallCount === 1) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return respond(fieldOptionsResponse);
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('Round step form — field-options fetch failure (GitHub issue #817)', () => {
  beforeEach(() => {
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
    mockSearchParams.current = new URLSearchParams(
      'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    mockRouterReplace.mockClear();
  });

  async function openDraftAndAddCodingRound(user: ReturnType<typeof userEvent.setup>) {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.selectOptions(within(dialog).getByLabelText('Round type'), 'coding');
    await user.click(within(dialog).getByRole('button', { name: 'Add new round' }));
  }

  it('shows an inline warning with a retry when field options fail to load, instead of silently dropping the fields', async () => {
    mockFetchByRoute(true);
    const user = userEvent.setup();
    await openDraftAndAddCodingRound(user);

    expect(
      await screen.findByText(/Round-specific details couldn.t load/),
    ).toBeInTheDocument();
    // The coding-round field (problemAlgorithms) never rendered either.
    expect(screen.queryByText('Round details')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Round details')).toBeInTheDocument();
    expect(screen.queryByText(/Round-specific details couldn.t load/)).not.toBeInTheDocument();
  });

  it('never shows the warning when field options load successfully', async () => {
    mockFetchByRoute(false);
    const user = userEvent.setup();
    await openDraftAndAddCodingRound(user);

    expect(await screen.findByText('Round details')).toBeInTheDocument();
    expect(screen.queryByText(/Round-specific details couldn.t load/)).not.toBeInTheDocument();
  });
});
