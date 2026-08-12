// Phase 43 (#612/#613) — theme preference storage and the FOUC-safe
// bootstrap script. Kept in one place so the storage key is never
// duplicated as a literal string between the blocking script (which
// runs standalone, before hydration, and can't import anything at
// runtime — see themeInitScript()) and the real ThemeProvider (#613).

export const THEME_STORAGE_KEY = 'ii-theme';

export type ThemePreference = 'light' | 'dark' | 'system';

// Inlined into layout.tsx's <head> via dangerouslySetInnerHTML, not
// imported as a module — it has to run before the JS bundle loads to
// avoid a flash of the wrong theme, so it can't reference anything
// outside this string. Defaults to the OS preference when nothing is
// stored yet, which is every visit until #613 ships the toggle UI —
// this alone must not regress the OS-driven dark mode every `dark:`
// class already relies on.
export function themeInitScript(): string {
  return (
    '(function(){try{' +
    `var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    "var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;" +
    "if(d)document.documentElement.classList.add('dark');" +
    '}catch(e){}})();'
  );
}

// GitHub issue #613 — the real toggle. 'system' is represented by the
// *absence* of a stored key (never a literal `'system'` value) so this
// stays the single source of truth themeInitScript() above also reads:
// no key means "resolve from the OS preference," on every code path.
export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

// Persists the choice (or clears it, for 'system') and applies the
// resulting `dark` class immediately — same class the bootstrap script
// sets before hydration, so there's no separate "apply" mechanism to
// keep in sync.
export function applyThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // localStorage unavailable (e.g. locked-down browser) — theme still
    // applies for this page view via the classList toggle below, it
    // just won't persist across visits.
  }

  const isDark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}
