import {
  applyThemePreference,
  getStoredThemePreference,
  THEME_STORAGE_KEY,
  themeInitScript,
} from '../src/lib/theme';

// themeInitScript() returns a plain string, not a function — it's meant
// to run standalone in <head>, before any JS bundle loads (see
// src/lib/theme.ts), so the only faithful way to test its actual
// behavior is to eval() it against a real DOM, same as the browser
// does. A unit test that only inspects the string's contents wouldn't
// catch a typo that breaks the runtime logic.
function runBootstrapScript(matches: boolean): void {
  window.matchMedia = jest.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
  document.documentElement.classList.remove('dark');
  // eslint-disable-next-line no-eval
  eval(themeInitScript());
}

describe('themeInitScript', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('adds the dark class when the stored preference is dark, regardless of OS preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runBootstrapScript(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('leaves the dark class off when the stored preference is light, regardless of OS preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runBootstrapScript(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to the OS preference when nothing is stored — the "system" choice, which is never itself the stored value (see applyThemePreference below)', () => {
    runBootstrapScript(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    runBootstrapScript(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('never throws when localStorage/matchMedia are unavailable (e.g. a locked-down browser)', () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error('blocked');
    };

    expect(() => runBootstrapScript(false)).not.toThrow();

    window.localStorage.getItem = original;
  });
});

describe('getStoredThemePreference', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns "system" when nothing is stored', () => {
    expect(getStoredThemePreference()).toBe('system');
  });

  it('returns the stored value when it is a valid preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredThemePreference()).toBe('dark');
  });

  it('returns "system" for a garbage stored value rather than throwing', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'not-a-real-theme');
    expect(getStoredThemePreference()).toBe('system');
  });
});

describe('applyThemePreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('stores "dark"/"light" literally and toggles the class to match', () => {
    applyThemePreference('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    applyThemePreference('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('"system" clears the stored key rather than writing the literal string, and resolves from the OS preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    applyThemePreference('system');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
