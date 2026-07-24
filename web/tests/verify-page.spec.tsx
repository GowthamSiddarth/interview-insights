import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import VerifyPage from '../src/app/auth/verify/page';

let params = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => params,
}));

function mockVerify(status: number) {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/verify')) {
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

describe('VerifyPage (GitHub issue #147)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // A hard navigation (not router.push) is what makes NavBar's own
    // session check re-run after login — see the page's own comment.
    // jsdom doesn't implement real navigation, so replace window.location
    // with a stub whose href setter we can assert on.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('consumes the token and hard-navigates home on success', async () => {
    params = new URLSearchParams({ token: 'a'.repeat(64) });
    mockVerify(200);

    render(<VerifyPage />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.href).toBe('/');
  });

  it('shows an expired-link message and a way to request a new one, on 410', async () => {
    params = new URLSearchParams({ token: 'a'.repeat(64) });
    mockVerify(410);

    render(<VerifyPage />);

    expect(await screen.findByText(/This login link has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new login link' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(window.location.href).toBe('');
  });

  it('shows an error when no token is present in the URL', async () => {
    params = new URLSearchParams();

    render(<VerifyPage />);

    expect(await screen.findByText('No login token was provided.')).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });
});
