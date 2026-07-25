import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { HelpTooltip } from '../src/components/HelpTooltip';

describe('HelpTooltip (GitHub issue #305)', () => {
  it('is hidden until hovered, then shown, then hidden again on unhover', async () => {
    const user = userEvent.setup();
    render(<HelpTooltip label="reachability help" text="How easy it was to reach them." />);

    expect(screen.queryByText('How easy it was to reach them.')).not.toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'reachability help' }));
    expect(await screen.findByText('How easy it was to reach them.')).toBeInTheDocument();

    await user.unhover(screen.getByRole('button', { name: 'reachability help' }));
    expect(screen.queryByText('How easy it was to reach them.')).not.toBeInTheDocument();
  });

  it('also shows on keyboard focus, for accessibility', async () => {
    const user = userEvent.setup();
    render(<HelpTooltip label="clarity help" text="How clear the prompt was." />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'clarity help' })).toHaveFocus();
    expect(await screen.findByText('How clear the prompt was.')).toBeInTheDocument();
  });
});
