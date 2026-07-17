import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

describe('HomePage', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }) as jest.Mock;
  });

  it('renders the platform name and loads the (empty) company list', async () => {
    render(<HomePage />);
    expect(screen.getByText('Interview Insights')).toBeInTheDocument();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/companies'),
      expect.anything(),
    ));
  });

  it('lets you change the selected company without a page reload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' },
        ]),
    }) as jest.Mock;

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    expect(await screen.findByText(/Using Acme Corp/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change company' }));

    expect(screen.queryByText(/Using Acme Corp/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acme Corp' })).toBeInTheDocument();
  });
});
