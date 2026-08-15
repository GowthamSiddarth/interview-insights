import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ResetPasswordPage from '../src/app/auth/reset-password/page';

let params = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => params,
}));

function mockConfirmReset(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/confirm-password-reset')) {
      if (status === 200) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ message: 'failed' }),
      });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// GitHub issue #683 (Phase 48, D104) — forgot-password flow, second half.
// Unlike /auth/verify, this doesn't auto-consume the token on load — it
// waits for the candidate to submit a new password first.
describe('ResetPasswordPage', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('submits the new password and hard-navigates home on success', async () => {
    params = new URLSearchParams({ token: 'a'.repeat(64) });
    mockConfirmReset(200);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      token: 'a'.repeat(64),
      newPassword: 'a-brand-new-password',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.href).toBe('/');
  });

  it('rejects a password shorter than 12 characters without navigating away', async () => {
    params = new URLSearchParams({ token: 'a'.repeat(64) });
    mockConfirmReset(200);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  it('shows an expired-link message and a way to request a new one, on 410', async () => {
    params = new URLSearchParams({ token: 'a'.repeat(64) });
    mockConfirmReset(410);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText(/This password reset link has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
      'href',
      '/login/forgot-password',
    );
    expect(window.location.href).toBe('');
  });

  it('shows an error and a way to request a new link when no token is present in the URL', () => {
    params = new URLSearchParams();

    render(<ResetPasswordPage />);

    expect(screen.getByText('No password reset token was provided.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
      'href',
      '/login/forgot-password',
    );
  });
});
