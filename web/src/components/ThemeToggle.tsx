'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { applyThemePreference, getStoredThemePreference, ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

// GitHub issue #613 built the working mechanism; #614 (this) adds the
// sun/moon/monitor icons once there was something to attach them to.
// Full segmented-control styling still lands with #616 (NavBar
// redesign, responsive layout).
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
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          onClick={() => choose(value)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
            preference === value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
