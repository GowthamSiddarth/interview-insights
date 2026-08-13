# Phase 43, Issue #613 — Light / Dark / System Theme Toggle

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43 and `docs/DECISIONS.md` D100.*

## The gap this closed

#612 made `darkMode: 'class'` real and shipped a bootstrap script that
resolves to the OS preference — but there was still no way for a
visitor to actually pick a theme. Every visit was implicitly
"system," with no override. This issue built the real mechanism: a
stored preference, a function that applies it, and a three-way switch
wired into `NavBar`.

## Key concept: "system" is the absence of a value, not a value

```ts
// src/lib/theme.ts
export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // theme still applies for this page view via the classList toggle
    // below, it just won't persist across visits.
  }
  const isDark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}
```

The tempting design is a stored `'system'` string as one of three
literal values. The problem: #612's bootstrap script already has its
own resolution logic (`t ? t==='dark' : matchMedia(...)`), and if
`applyThemePreference` stored the literal string `'system'`, that
script's `t ? ... : ...` branch would treat any truthy stored value —
including `'system'`— as an explicit choice, never falling through to
its own OS-preference check. Representing "system" as *no key at all*
means both the script and the real toggle read the exact same source
of truth, with no second code path to keep in sync.

## Key concept: the toggle is deliberately unstyled, on purpose

```tsx
// src/components/ThemeToggle.tsx
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  useEffect(() => {
    setPreference(getStoredThemePreference());
  }, []);
  // …plain buttons, Light/Dark/System labels, aria-pressed
}
```

`preference` starts `null`, not a real default — reading localStorage
during server rendering would mismatch the bootstrap script's own
client-only resolution, so it waits for a `useEffect` to run before
claiming any button is active. That's the same tri-state idiom
`NavBar`'s own session check already uses (D32): render nothing
committal until the client-only truth is known, rather than guess and
possibly flash the wrong state. Styling was left plain — three text
buttons, not the segmented-control look from the design brief —
because #614 (icons) and #616 (NavBar redesign, responsive layout)
hadn't landed yet. This issue's job was "does it work," verified with
something to actually click, not "does it match the token system,"
which needs pieces that don't exist yet.

## Verification

201/201 tests (nine new: rendering defaults, reflecting a stored
preference, choosing Dark/Light/System and checking the resulting
class + localStorage state), lint and build clean. Real-browser check
in Chromium: clicking Dark flips the page immediately, **survives a
reload** — proof it's reading persisted state, not just in-memory
React state that would reset on refresh — and clicking System clears
the stored key rather than writing the literal string.
