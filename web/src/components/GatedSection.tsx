'use client';

import Link from 'next/link';

// Soft-gates content behind a login prompt (GitHub issue #226, Phase 21) —
// never a hard redirect. `loggedIn` is the tri-state session-hint check
// already established in NavBar.tsx/the wizard (D32): null while the
// cookie hint hasn't been checked yet (avoid a flash of gated content),
// false to show the prompt, true to render children untouched.
interface GatedSectionProps {
  loggedIn: boolean | null;
  prompt: string;
  children: React.ReactNode;
}

export function GatedSection({ loggedIn, prompt, children }: GatedSectionProps) {
  if (loggedIn === null) return null;
  if (loggedIn) return <>{children}</>;
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center dark:border-gray-600 dark:bg-gray-800">
      <p className="text-sm text-gray-600 dark:text-gray-300">{prompt}</p>
      <Link
        href="/login"
        className="mt-2 inline-block text-sm font-medium text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Log in to unlock
      </Link>
    </div>
  );
}
