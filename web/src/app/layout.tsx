import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import * as Tooltip from '@radix-ui/react-tooltip';
import './globals.css';
import { NavBar } from '@/components/NavBar';
import { themeInitScript } from '@/lib/theme';

// Self-hosted at build time (next/font/google fetches once during `next
// build`, then serves from the app's own origin) — no runtime request to
// Google's CDN, so this doesn't add an external dependency at request time.
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Interview Insights',
  description: 'Structured, per-round interview experience ratings and company analytics.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html>: the bootstrap script below adds
    // the `dark` class before React hydrates (Phase 43 #612), which would
    // otherwise mismatch the server-rendered markup.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking, not next/script — must run before first paint to
            avoid a flash of the wrong theme. See src/lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body
        suppressHydrationWarning
        className="bg-gray-50 font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100"
      >
        {/* One shared Tooltip.Provider (GitHub issue #615) so every
            HelpTooltip on a page coordinates hover timing/skip-delay
            with the others, instead of each instance being its own
            isolated tooltip. */}
        <Tooltip.Provider>
          <NavBar />
          {children}
        </Tooltip.Provider>
      </body>
    </html>
  );
}
