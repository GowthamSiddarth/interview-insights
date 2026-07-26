import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ConfirmationModal } from '../src/components/ConfirmationModal';

// GitHub issue #372 (Phase 35) — the first real modal in this app: a
// plain informational acknowledgment, OK and the corner close both just
// dismiss it identically.
describe('ConfirmationModal', () => {
  it('renders the title and message', () => {
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={jest.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Request submitted')).toBeInTheDocument();
    expect(screen.getByText('All done.')).toBeInTheDocument();
  });

  it('calls onClose when OK is clicked', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'OK' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the corner close button is clicked', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
