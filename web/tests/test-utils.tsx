import { render as rtlRender, RenderOptions } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ReactElement, ReactNode } from 'react';

// jsdom doesn't implement ResizeObserver (Radix Tooltip.Content uses
// it internally, via @radix-ui/react-use-size, to measure itself for
// positioning) — a real no-op is enough since jsdom never does real
// layout anyway. A known, common gap when testing Radix components,
// not specific to this app.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Standard Testing Library "custom render" pattern — wraps every
// render() in the same Tooltip.Provider the real app's RootLayout
// provides (GitHub issue #615). Any component tree that includes a
// HelpTooltip needs this ancestor or Radix throws `Tooltip must be
// used within TooltipProvider` at render time, even when the tooltip
// itself is never hovered/focused. Use this instead of importing
// `render` directly from '@testing-library/react' in any test whose
// tree might include one (the wizard step forms do today; more will
// as later Phase 43 issues land) — cheap to use everywhere, so default
// to it rather than tracking which trees happen to need it.
function AllProviders({ children }: { children: ReactNode }) {
  return <Tooltip.Provider>{children}</Tooltip.Provider>;
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
