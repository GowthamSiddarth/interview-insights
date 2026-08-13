# Phase 43, Issue #612 — Design Tokens & Tailwind Foundation

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43 and `docs/DECISIONS.md` D100.*

## The gap this closed

Every screen in `web/` ran on stock Tailwind: `gray-50`/`gray-950`
backgrounds, `indigo-600` as the only accent, no token layer at all.
Dark mode wasn't a feature a visitor could choose — Tailwind's default
`media` strategy meant every `dark:` class just mirrored the OS
preference. This issue was the foundation the rest of Phase 43 builds
on: a real neutral/accent palette, a `darkMode: 'class'` strategy that
a real toggle (#613) can drive, and the CSS custom-property tokens
later issues (#619, #620) need for things Tailwind's static classes
can't express.

## Key concept: remap the palette, don't rewrite components

The obvious way to change every component's colors is to touch every
component. The actually-necessary way, once you check how the
components reference color, is much smaller. A grep across `web/src`
for every `(gray|indigo|red|amber)-[0-9]+` token in use turned up
something useful: every single one is a stock Tailwind class name —
`bg-indigo-600`, `text-gray-500` — never an arbitrary hex value.

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      gray: { 50: '#f6f7fb', 100: '#eef0f6', /* … */ 950: '#10141c' },
      indigo: { 50: '#e6f5f4', 300: '#7fd0c8', 400: '#3fd1cb',
                 500: '#14a39b', 600: '#0e7c86', 700: '#0a6670', 950: '#062023' },
    },
  },
},
```

Tailwind's `extend` deep-merges per color family, so overriding only
the shades a codebase actually uses (`indigo-100`/`indigo-800` are
never referenced here, and stay Tailwind's stock blue-violet — it
doesn't matter, nothing renders them) changes every component's
rendered color with a one-file diff. New teal shades were chosen to
preserve every interaction pattern the old indigo scale had wired up —
hover darkens a shade in light mode, hover lightens a shade in dark
mode, a `-50`/`-950` tint pairs with a `-700`/`-300` ink for badges —
same shade *numbers*, same *role*, only the hue changed. `red`/`amber`
were left untouched deliberately: nothing in the design brief called
for changing the error/warning hues, and Tailwind's defaults there
already clear the same contrast bar the new scales were checked
against.

## Key concept: a theme switch needs a bootstrap script before it needs a toggle

`darkMode: 'class'` on its own is a regression: nothing sets the
`dark` class yet, so every `dark:` style in the app would just stop
firing until #613 ships. The fix landed in the same PR as the
strategy flip, not after it:

```ts
// src/lib/theme.ts
export function themeInitScript(): string {
  return (
    '(function(){try{' +
    `var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    "var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;" +
    "if(d)document.documentElement.classList.add('dark');" +
    '}catch(e){}})();'
  );
}
```

```tsx
// src/app/layout.tsx
<html lang="en" className={inter.variable} suppressHydrationWarning>
  <head>
    <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
  </head>
```

Inlined as a blocking `<script>`, not `next/script` — it has to run
before first paint to avoid a flash of the wrong theme, and it has to
run standalone, before the JS bundle loads, so it can't import
anything. With nothing stored yet (every visit, until #613 ships the
toggle), it falls back to the OS preference — the exact behavior the
old `media` strategy already gave every visitor, just re-implemented
on top of the class strategy instead of lost by it.

## Key concept: tokens for what Tailwind's static palette can't express

`globals.css` also gained a set of CSS custom properties nothing
consumes yet — status colors (with a text-safe `-ink` variant per the
`dataviz` skill's own contrast findings: the raw warning/serious hexes
measure 1.79/2.57:1 on a light surface, failing outright as text
color), a single-hue sequential ramp for magnitude charts, and
elevation shadows. Defined now, switching on the same `.dark` class
Tailwind's `dark:` variant uses, so #619 and #620 aren't also blocked
on inventing this palette when their turn comes.

## Verification

`npm run lint`/`npm test` (191/191, four new tests for the bootstrap
script covering stored-dark, stored-light, OS-fallback, and a
throws-safe path when localStorage is unavailable) and `npm run
build` all clean. Real-browser verification, not just the test suite:
Playwright/Chromium in both light and emulated-dark
`prefers-color-scheme` confirmed the palette renders correctly and
`<html>` picks up the `dark` class exactly when the OS prefers dark,
with no console errors beyond a pre-existing local-dev CORS gap (the
API isn't configured for `localhost:3000` as an origin in this dev
setup) unrelated to this change.
