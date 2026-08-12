'use client';

import { useEffect, useState } from 'react';
import { applyThemePreference, getStoredThemePreference, ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// GitHub issue #613 — the working mechanism: three-way switch, wired
// into NavBar, persisted. Deliberately plain buttons, not the
// segmented-control styling / icons from the design brief — those land
// with #614 (icons) and #616 (NavBar redesign, responsive layout),
// once there's something to style. This issue is "does it work," not
// "does it match the token system yet."
export function ThemeToggle() {
  // null until mounted — reading localStorage during SSR would mismatch
  // the bootstrap script's own client-only resolution (same tri-state
  // idiom NavBar's own session check already uses, D32).
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(getStoredThemePreference());
  }, []);

  function choose(next: ThemePreference) {
    applyThemePreference(next);
    setPreference(next);
  }

  return (
    <div role="group" aria-label="Theme" className="flex gap-1 text-xs">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preference === option.value}
          onClick={() => choose(option.value)}
          className={`rounded-md px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
            preference === option.value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
