import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import LoginPage from '../src/app/login/page';

function mockLogin(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) {
      if (status === 200) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// GitHub issue #683 (Phase 48, D104) — password login is now the primary
// /login flow (the old magic-link-only page moved to /login/magic-link).
describe('LoginPage (password login, issue #683)', () => {
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

  it('submits credentials and redirects home on success', async () => {
    mockLogin(200);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/login'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      email: 'me@example.com',
      password: 'correct-password',
    });
    await waitFor(() => expect(window.location.href).toBe('/'));
  });

  it('shows an error and does not redirect on incorrect credentials', async () => {
    mockLogin(401);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('shows a rate-limit-specific error on 429', async () => {
    mockLogin(429);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('links to registration, forgot-password, and the magic-link fallback', () => {
    render(<LoginPage />);

    expect(screen.getByRole('link', { name: 'New here? Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/login/forgot-password',
    );
    expect(
      screen.getByRole('link', { name: 'Or log in with a one-time email link instead' }),
    ).toHaveAttribute('href', '/login/magic-link');
  });
});
