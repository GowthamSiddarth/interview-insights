import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import StaffAccountsPage from '../src/app/moderation/staff/page';

const push = jest.fn();
const mockRouter = { push };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const accountsMock = [
  {
    id: 'staff-1',
    username: 'existing-staff',
    email: 'existing-staff@example.com',
    role: 'staff',
    isActive: true,
    createdById: 'mod-me',
    createdAt: '2026-08-01T00:00:00Z',
  },
];

function mockFetchAsAdmin() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/admin/me') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }),
      });
    }
    if (url.endsWith('/admin/staff') && method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(accountsMock) });
    }
    if (url.endsWith('/admin/staff') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { username: string; email: string; role: string };
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'staff-new',
            username: body.username,
            email: body.email,
            role: body.role,
            isActive: true,
            createdById: 'mod-me',
            createdAt: '2026-08-11T00:00:00Z',
            password: 'one-time-generated-password',
          }),
      });
    }
    if (url.endsWith('/admin/staff/staff-1/deactivate') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...accountsMock[0], isActive: false }),
      });
    }
    if (url.endsWith('/admin/staff/staff-1/reset-password') && method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ password: 'reset-one-time-password' }) });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('StaffAccountsPage (GitHub issue #591, Phase 42, D99)', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('redirects a non-admin session to /moderation without ever calling GET /admin/staff', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/admin/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'mod-mod', username: 'moderator', role: 'moderator' }),
        });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    render(<StaffAccountsPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation'));
    expect(screen.queryByText('Staff accounts')).not.toBeInTheDocument();
  });

  it('redirects to login when the session check 401s', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    ) as jest.Mock;

    render(<StaffAccountsPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
  });

  it('lists existing accounts for an admin session', async () => {
    mockFetchAsAdmin();
    render(<StaffAccountsPage />);

    expect(await screen.findByText('existing-staff')).toBeInTheDocument();
  });

  it('creates an account and shows the one-time password', async () => {
    mockFetchAsAdmin();
    const user = userEvent.setup();
    render(<StaffAccountsPage />);
    await screen.findByText('existing-staff');

    await user.type(screen.getByLabelText('Username'), 'new-moderator');
    await user.type(screen.getByLabelText('Email'), 'new-moderator@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'moderator');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('one-time-generated-password')).toBeInTheDocument();
    expect(screen.getByText('new-moderator', { exact: false })).toBeInTheDocument();
  });

  it('deactivating an account calls the endpoint', async () => {
    mockFetchAsAdmin();
    const user = userEvent.setup();
    render(<StaffAccountsPage />);
    await screen.findByText('existing-staff');

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/staff/staff-1/deactivate'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('resetting a password shows the new one-time password', async () => {
    mockFetchAsAdmin();
    const user = userEvent.setup();
    render(<StaffAccountsPage />);
    await screen.findByText('existing-staff');

    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('reset-one-time-password')).toBeInTheDocument();
  });
});
