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

  // GitHub issue #622 — the #615 migration to Radix Dialog claimed a
  // real focus trap and ESC-to-close as its whole justification over
  // the hand-rolled version; neither had a test until this audit
  // caught the gap.
  it('calls onClose on Escape', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus inside the dialog on open, not left on whatever was focused before', async () => {
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={jest.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('traps Tab focus inside the dialog — cycling never lands on document.body', async () => {
    const user = userEvent.setup();
    render(<ConfirmationModal title="Request submitted" message="All done." onClose={jest.fn()} />);

    const dialog = screen.getByRole('dialog');
    // More tabs than the dialog has focusable elements (Close + OK) —
    // if the trap were broken, this would walk focus out to <body>.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
