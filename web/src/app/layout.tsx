import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { NavBar } from '@/components/NavBar';

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
    <html lang="en" className={inter.variable}>
      <body
        suppressHydrationWarning
        className="bg-gray-50 font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100"
      >
        <NavBar />
        {children}
      </body>
    </html>
  );
}
