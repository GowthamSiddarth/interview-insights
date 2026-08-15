import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import RegisterPage from '../src/app/register/page';

function mockRegister(status: number, message = 'Conflict') {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/register')) {
      if (status === 201) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: false, status, json: () => Promise.resolve({ message }) });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

// GitHub issue #683 (Phase 48, D104) — password registration.
describe('RegisterPage', () => {
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

  it('registers and redirects home on success', async () => {
    mockRegister(201);
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/register'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      email: 'me@example.com',
      password: 'a-strong-password',
    });
    await waitFor(() => expect(window.location.href).toBe('/'));
  });

  it('rejects a password shorter than 12 characters before ever calling the API', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('shows a specific message on 409 (email already has a password set)', async () => {
    mockRegister(409);
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText(/An account with this email already has a password set/),
    ).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('links back to log in', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('link', { name: 'Already have an account? Log in' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
