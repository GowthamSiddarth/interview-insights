import type { Config } from 'tailwindcss';

// Phase 43 (#612): 'class' instead of the default 'media' strategy — a
// visitor's choice (persisted in localStorage, see src/lib/theme.ts)
// now controls dark mode, not just the OS preference. The bootstrap
// script in layout.tsx sets the `dark` class before hydration so this
// doesn't regress the OS-driven dark mode every `dark:` class already
// relied on.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // --font-sans is set on <html> by next/font/google in layout.tsx —
      // falls back to the system stack if the variable is ever unset
      // (e.g. a bare component test rendered outside the root layout).
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Slate-leaning neutral scale replacing Tailwind's stock gray —
      // every component already references `gray-*`/`indigo-*` by name
      // (never an arbitrary hex), so remapping the two palettes here is
      // the entire visual refresh: no component file changes, nothing
      // to break. Only the shades actually used in src/ are given new
      // values (see docs/DECISIONS.md D100) — indigo keeps Tailwind's
      // defaults for any shade this app doesn't reference.
      colors: {
        gray: {
          50: '#f6f7fb',
          100: '#eef0f6',
          200: '#e2e5ee',
          300: '#cbd0dd',
          400: '#9aa3b5',
          500: '#6b7280',
          600: '#4b5768',
          700: '#37414f',
          800: '#2a3340',
          900: '#1b222d',
          950: '#10141c',
        },
        indigo: {
          50: '#e6f5f4',
          300: '#7fd0c8',
          400: '#3fd1cb',
          500: '#14a39b',
          600: '#0e7c86',
          700: '#0a6670',
          950: '#062023',
        },
      },
    },
  },
  plugins: [],
};

export default config;
