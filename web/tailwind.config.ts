import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // --font-sans is set on <html> by next/font/google in layout.tsx —
      // falls back to the system stack if the variable is ever unset
      // (e.g. a bare component test rendered outside the root layout).
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
