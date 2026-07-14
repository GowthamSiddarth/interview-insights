import { render, screen, waitFor } from '@testing-library/react';
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
});
