import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ThemeToggle } from '../src/components/ThemeToggle';
import { THEME_STORAGE_KEY } from '../src/lib/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    // jsdom doesn't implement matchMedia — only exercised by the
    // "System" choice (applyThemePreference short-circuits past it for
    // 'dark'/'light', see src/lib/theme.ts), but every test renders the
    // toggle, so mock it globally here rather than per-test.
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('renders all three options, defaulting to System when nothing is stored', async () => {
    render(<ThemeToggle />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects a previously stored preference on mount', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('choosing Dark persists the choice and applies the dark class', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await screen.findByRole('button', { name: 'System' });

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('choosing System clears the stored key rather than storing the literal value', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    await screen.findByRole('button', { name: 'Dark' });

    await user.click(screen.getByRole('button', { name: 'System' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('choosing Light removes the dark class', async () => {
    const user = userEvent.setup();
    document.documentElement.classList.add('dark');
    render(<ThemeToggle />);
    await screen.findByRole('button', { name: 'System' });

    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  // GitHub issue #622 — plain <button> elements are keyboard-operable by
  // default, but worth confirming directly for this phase's one
  // brand-new always-visible interactive control.
  it('is fully keyboard-operable: tab to a button, activate with Enter', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await screen.findByRole('button', { name: 'System' });

    await user.tab();
    expect(screen.getByRole('button', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
