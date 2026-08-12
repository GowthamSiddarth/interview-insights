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
