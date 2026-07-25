import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import RoundTypeOptionsPage from '../src/app/moderation/round-type-options/page';
import { ROUND_TYPES } from '../src/app/wizard/round-type-labels';

const push = jest.fn();
const mockRouter = { push };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const schema = Object.fromEntries(
  ROUND_TYPES.map((rt) => [
    rt,
    rt === 'coding'
      ? {
          fields: [
            { key: 'problemAlgorithms', kind: 'controlled-multi', options: ['DFS', 'BFS'] },
            { key: 'problemDescription', kind: 'text' },
          ],
        }
      : rt === 'other'
        ? { fields: [{ key: 'notes', kind: 'text' }] }
        : { fields: [] },
  ]),
);

const codingRows = [
  {
    id: 'opt-1',
    roundType: 'coding',
    fieldKey: 'problemAlgorithms',
    value: 'DFS',
    sortOrder: 0,
    isActive: true,
  },
  {
    id: 'opt-2',
    roundType: 'coding',
    fieldKey: 'problemAlgorithms',
    value: 'BFS',
    sortOrder: 1,
    isActive: true,
  },
];

function mockFetch(rows = codingRows) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/admin/me') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'admin' }) });
    }
    if (url.endsWith('/round-types/field-options') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(schema) });
    }
    if (url.endsWith('/admin/round-types/coding/field-options') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });
    }
    if (url.endsWith('/admin/round-types/coding/field-options') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'opt-new',
            roundType: 'coding',
            fieldKey: 'problemAlgorithms',
            value: 'A*',
            sortOrder: 2,
            isActive: true,
          }),
      });
    }
    if (/\/admin\/round-types\/field-options\/.+$/.test(url) && method === 'PATCH') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('RoundTypeOptionsPage (Phase 27 issue #264)', () => {
  beforeEach(() => {
    push.mockClear();
    mockFetch();
  });

  it('redirects to login when the session check 401s', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/admin/me')) {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    render(<RoundTypeOptionsPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
    expect(screen.queryByText('Round-type field options')).not.toBeInTheDocument();
  });

  it('shows a prompt to pick a round type before one is selected', async () => {
    render(<RoundTypeOptionsPage />);

    expect(await screen.findByText(/Pick a round type/)).toBeInTheDocument();
  });

  it('selecting a round type with only text fields shows the no-controlled-fields empty state', async () => {
    const user = userEvent.setup();
    render(<RoundTypeOptionsPage />);

    await screen.findByText('Round-type field options');
    await user.selectOptions(screen.getByLabelText('Round type'), 'other');

    expect(await screen.findByText(/no controlled-vocabulary fields/)).toBeInTheDocument();
  });

  it('selecting coding loads its controlled field and shows existing values', async () => {
    const user = userEvent.setup();
    render(<RoundTypeOptionsPage />);

    await screen.findByText('Round-type field options');
    await user.selectOptions(screen.getByLabelText('Round type'), 'coding');

    expect(await screen.findByText('problemAlgorithms')).toBeInTheDocument();
    expect(screen.getByDisplayValue('DFS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BFS')).toBeInTheDocument();
    // The text field (problemDescription) never gets its own section.
    expect(screen.queryByText('problemDescription')).not.toBeInTheDocument();
  });

  it('adding a new value posts to the admin endpoint and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<RoundTypeOptionsPage />);

    await screen.findByText('Round-type field options');
    await user.selectOptions(screen.getByLabelText('Round type'), 'coding');
    await screen.findByText('problemAlgorithms');

    await user.type(screen.getByLabelText('New value for problemAlgorithms'), 'A*');
    await user.click(screen.getByRole('button', { name: 'Add value' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/round-types/coding/field-options'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ fieldKey: 'problemAlgorithms', value: 'A*' }) }),
      ),
    );
  });

  it('retiring a value sends isActive: false', async () => {
    const user = userEvent.setup();
    render(<RoundTypeOptionsPage />);

    await screen.findByText('Round-type field options');
    await user.selectOptions(screen.getByLabelText('Round type'), 'coding');
    await screen.findByText('problemAlgorithms');

    const retireButtons = await screen.findAllByRole('button', { name: 'Retire' });
    await user.click(retireButtons[0]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/round-types/field-options/opt-1'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ isActive: false }) }),
      ),
    );
  });

  it('shows a retired value as inactive with a Reactivate action', async () => {
    mockFetch([
      { id: 'opt-1', roundType: 'coding', fieldKey: 'problemAlgorithms', value: 'DFS', sortOrder: 0, isActive: false },
    ]);
    const user = userEvent.setup();
    render(<RoundTypeOptionsPage />);

    await screen.findByText('Round-type field options');
    await user.selectOptions(screen.getByLabelText('Round type'), 'coding');

    expect(await screen.findByText('retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });
});
