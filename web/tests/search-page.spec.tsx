import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SearchPage from '../src/app/search/page';

describe('SearchPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }) as jest.Mock;
  });

  it('shows an explicit empty state — not a blank list — when a company search matches nothing', async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

    await user.type(screen.getByPlaceholderText('Company name'), 'Nonexistent Co');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(screen.getByText('No companies match "Nonexistent Co".')).toBeInTheDocument(),
    );
  });

  it('shows a distinct loading indicator while a search is in flight (GitHub issue #61)', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    ) as jest.Mock;

    const user = userEvent.setup();
    render(<SearchPage />);

    await user.type(screen.getByPlaceholderText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Before the fetch resolves: a loading indicator, not silence and not
    // an empty state — those would be indistinguishable from "haven't
    // searched yet" or "confirmed zero results".
    await waitFor(() => expect(screen.getByText('Searching…')).toBeInTheDocument());
    expect(screen.queryByText(/No companies match/)).not.toBeInTheDocument();

    resolveFetch({ ok: true, json: () => Promise.resolve([]) });

    await waitFor(() => expect(screen.getByText('No companies match "Acme".')).toBeInTheDocument());
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });
});
