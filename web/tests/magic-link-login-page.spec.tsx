import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import LoginPage from '../src/app/login/magic-link/page';

function mockRequestLink(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/request-link')) {
      if (status === 200) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ message: 'Too Many Requests' }),
      });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('MagicLinkLoginPage (GitHub issue #147, moved to /login/magic-link by #683)', () => {
  it('requests a magic link and shows the same confirmation regardless of whether the email is known', async () => {
    mockRequestLink(200);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Send login link' }));

    expect(await screen.findByText(/A login link is on its way to me@example.com/)).toBeInTheDocument();
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      email: 'me@example.com',
    });
    // No password field anywhere — this is a magic-link-only login.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('shows a rate-limit-specific error on 429, without a confirmation', async () => {
    mockRequestLink(429);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Send login link' }));

    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument();
    expect(screen.queryByText(/A login link is on its way/)).not.toBeInTheDocument();
  });
});
