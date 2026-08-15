import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ForgotPasswordPage from '../src/app/login/forgot-password/page';

function mockRequestReset(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/request-password-reset')) {
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

// GitHub issue #683 (Phase 48, D104) — forgot-password flow, first half.
describe('ForgotPasswordPage', () => {
  it('requests a reset link and shows the same confirmation regardless of whether the email is known', async () => {
    mockRequestReset(200);
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText(/If an account exists for me@example.com, a password reset link is on its way/),
    ).toBeInTheDocument();
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toEqual({
      email: 'me@example.com',
    });
  });

  it('shows a rate-limit-specific error on 429, without a confirmation', async () => {
    mockRequestReset(429);
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument();
    expect(screen.queryByText(/a password reset link is on its way/)).not.toBeInTheDocument();
  });
});
