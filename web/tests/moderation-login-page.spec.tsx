import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ModerationLoginPage from '../src/app/moderation/login/page';

function mockLogin(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/admin/login')) {
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

describe('ModerationLoginPage (Phase 18 issue #160)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // GitHub issue #591 (Phase 42) — login now hard-navigates
    // (window.location.href), not router.push() — jsdom doesn't
    // implement real navigation, so replace window.location with a stub
    // whose href setter tests can assert on, same pattern
    // my-reviews-page.spec.tsx/verify-page.spec.tsx already use.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('submits credentials and redirects to the moderation queue on success', async () => {
    mockLogin(200);
    const user = userEvent.setup();
    render(<ModerationLoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/admin/login'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      username: 'admin',
      password: 'correct-password',
    });
    await waitFor(() => expect(window.location.href).toBe('/moderation'));
  });

  it('shows an error and does not redirect on incorrect credentials', async () => {
    mockLogin(401);
    const user = userEvent.setup();
    render(<ModerationLoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Incorrect username or password.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });

  it('shows a rate-limit-specific error on 429', async () => {
    mockLogin(429);
    const user = userEvent.setup();
    render(<ModerationLoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });
});
