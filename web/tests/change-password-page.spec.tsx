import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ChangePasswordPage from '../src/app/moderation/change-password/page';

const push = jest.fn();
const mockRouter = { push };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

function mockFetch(changePasswordStatus: number, changePasswordBody: unknown = { status: 'ok' }) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/admin/me') && method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'mod-me', username: 'admin', role: 'admin' }),
      });
    }
    if (url.endsWith('/auth/admin/change-password') && method === 'POST') {
      return Promise.resolve({
        ok: changePasswordStatus === 200,
        status: changePasswordStatus,
        json: () => Promise.resolve(changePasswordBody),
      });
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  }) as jest.Mock;
}

describe('ChangePasswordPage (GitHub issue #589/#591, Phase 42, D99)', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('redirects to login when the session check 401s', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    ) as jest.Mock;

    render(<ChangePasswordPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/moderation/login'));
  });

  it('changes the password on success', async () => {
    mockFetch(200);
    const user = userEvent.setup();
    render(<ChangePasswordPage />);
    await screen.findByText('Applies to your own account only.');

    await user.type(screen.getByLabelText('Current password'), 'old-password-value');
    await user.type(screen.getByLabelText('New password'), 'a-new-strong-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[1][1].body))).toEqual({
      currentPassword: 'old-password-value',
      newPassword: 'a-new-strong-password',
    });
  });

  it('shows a client-side error without calling the endpoint when the confirmation does not match', async () => {
    mockFetch(200);
    const user = userEvent.setup();
    render(<ChangePasswordPage />);
    await screen.findByText('Applies to your own account only.');

    await user.type(screen.getByLabelText('Current password'), 'old-password-value');
    await user.type(screen.getByLabelText('New password'), 'a-new-strong-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'does-not-match');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('New password and confirmation do not match.'),
    ).toBeInTheDocument();
    expect(
      (global.fetch as jest.Mock).mock.calls.some(([url]: [string]) =>
        String(url).includes('/auth/admin/change-password'),
      ),
    ).toBe(false);
  });

  it('shows the backend error message on a wrong current password, without redirecting to login', async () => {
    mockFetch(401, { message: 'Current password is incorrect.' });
    const user = userEvent.setup();
    render(<ChangePasswordPage />);
    await screen.findByText('Applies to your own account only.');

    await user.type(screen.getByLabelText('Current password'), 'wrong-password');
    await user.type(screen.getByLabelText('New password'), 'a-new-strong-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalledWith('/moderation/login');
  });
});
