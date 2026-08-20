import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StaffAuditLogPage from '../src/app/moderation/staff/audit-log/page';

const push = jest.fn();
const mockRouter = { push };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const entriesMock = [
  {
    id: 'audit-2',
    actorId: 'mod-admin',
    actorUsername: 'admin',
    targetId: 'staff-1',
    targetUsername: 'existing-staff',
    action: 'role_changed',
    detail: { oldRole: 'staff', newRole: 'moderator' },
    createdAt: '2026-08-20T12:00:00Z',
  },
  {
    id: 'audit-1',
    actorId: 'mod-admin',
    actorUsername: 'admin',
    targetId: 'staff-1',
    targetUsername: 'existing-staff',
    action: 'account_created',
    detail: null,
    createdAt: '2026-08-19T12:00:00Z',
  },
];

function mockFetchAsAdmin() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/admin/me')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'mod-admin', username: 'admin', role: 'admin' }),
      });
    }
    if (url.endsWith('/admin/staff/audit-log')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(entriesMock) });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// GitHub issue #799 (Phase 54).
describe('StaffAuditLogPage', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('redirects a non-admin session to /moderation without calling the audit log endpoint', async () => {
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

    render(<StaffAuditLogPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation'));
    expect(screen.queryByText('Staff audit log')).not.toBeInTheDocument();
  });

  it('redirects to login when the session check 401s', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    ) as jest.Mock;

    render(<StaffAuditLogPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
  });

  it('lists entries most-recent-first with resolved usernames and detail', async () => {
    mockFetchAsAdmin();
    render(<StaffAuditLogPage />);

    expect(await screen.findByText('Role changed')).toBeInTheDocument();
    expect(screen.getByText('Account created')).toBeInTheDocument();
    expect(screen.getByText(/oldRole: staff/)).toBeInTheDocument();

    const headings = screen.getAllByText(/Role changed|Account created/).map((el) => el.textContent);
    expect(headings).toEqual(['Role changed', 'Account created']);
  });

  it('shows an empty state when there are no entries yet', async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/admin/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'mod-admin', username: 'admin', role: 'admin' }),
        });
      }
      if (url.endsWith('/admin/staff/audit-log')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }) as jest.Mock;

    render(<StaffAuditLogPage />);

    expect(await screen.findByText('No audit log entries yet.')).toBeInTheDocument();
  });
});
