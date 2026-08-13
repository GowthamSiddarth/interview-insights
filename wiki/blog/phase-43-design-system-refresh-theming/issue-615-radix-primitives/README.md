# Phase 43, Issue #615 — Accessible Primitives via Radix UI

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

`ConfirmationModal` (Phase 35, #372) and `HelpTooltip` (Phase 28,
#305) were both hand-rolled: a `useState` toggle plus manual
`onMouseEnter`/`onFocus` wiring for the tooltip, a plain `<div>` with
`role="dialog"` and no keyboard behavior at all for the modal. Neither
had a focus trap. Neither closed on Escape. This issue migrated both
onto Radix's headless Dialog/Tooltip primitives, trading hand-rolled
approximations for the real thing.

## Key concept: every close path routes through one prop

```tsx
// src/components/ConfirmationModal.tsx
<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
    <Dialog.Content className="…">
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Close asChild>
        <button aria-label="Close"><X /></button>
      </Dialog.Close>
      <Dialog.Description>{message}</Dialog.Description>
      <Dialog.Close asChild><Button>OK</Button></Dialog.Close>
```

`open` is always `true` — the parent already controls mounting via
conditional rendering (same as before), so there's no separate
trigger. `onOpenChange` becomes the single funnel every dismissal
path goes through: the corner X, the OK button, Escape, and clicking
the overlay all call the same `onClose`, where the hand-rolled version
only wired up the two buttons and had no keyboard or overlay handling
at all.

## Key concept: fixing jsdom flakiness and restoring real behavior turned out to be the same fix

```tsx
// src/components/HelpTooltip.tsx
<Tooltip.Root delayDuration={150} disableHoverableContent>
```

Migrating the tooltip test suite surfaced a real jsdom/`user-event`
flakiness: `unhover()` sometimes left Radix's internal state stuck
open, because Radix's default hoverable-content behavior gives the
pointer a grace period to move from the trigger into the tooltip
content itself before closing — logic that depends on real pointer
coordinates jsdom doesn't simulate faithfully. `disableHoverableContent`
turns that grace period off. It wasn't a test-only workaround grafted
on to make CI green — it's what makes the component's *actual*
behavior match the original hand-rolled version exactly: a one-line
definition tooltip, nothing inside it to interact with, no reason a
user would ever need to move their pointer into it.

## Key concept: a shared context requirement breaks tests that never mention the component that needs it

Any tree containing a `HelpTooltip` needs a `Tooltip.Provider`
ancestor, or Radix throws at render time — even in a test that never
hovers anything. That broke six existing test files (22 tests) whose
rendered trees happened to include the wizard's round/recruiter step
forms, which use `HelpTooltip` internally. The fix wasn't patching six
files with a wrapper each:

```tsx
// tests/test-utils.tsx
function AllProviders({ children }: { children: ReactNode }) {
  return <Tooltip.Provider>{children}</Tooltip.Provider>;
}
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}
export * from '@testing-library/react';
```

The standard Testing-Library "custom render" pattern, reusable by any
future test whose tree might include a `HelpTooltip` — not just the
six that broke today. The same file also carries a minimal
`ResizeObserver` polyfill, since jsdom doesn't implement it and
`Tooltip.Content` uses it internally for positioning; a real no-op is
enough, since jsdom never does real layout anyway.

## Verification

Full suite green (31 suites, 203 tests) at the time, lint and build
clean. Real-browser smoke check confirmed the new `Tooltip.Provider`
wrapping the whole tree in `layout.tsx` didn't break page rendering
anywhere. Deeper end-to-end verification of the modal/tooltip in their
actual usage contexts (the wizard, the create-company flow) hit the
same local-dev CORS gap already documented in prior issues — the Jest
suite, exercising real Radix rendering rather than mocks, carried the
verification weight here. A follow-up audit (#622) later added
explicit tests for the focus-trap and Escape-key behavior this issue's
commit message claimed but hadn't directly tested yet — see that
post.
