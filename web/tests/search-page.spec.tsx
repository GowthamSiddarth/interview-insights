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
});
