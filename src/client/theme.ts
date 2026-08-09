import { useCallback, useEffect, useState } from 'react';

/**
 * Light, dark, or whatever the device says. The choice lives in
 * localStorage under the same key `index.html` reads before the first paint,
 * so a reload never flashes the wrong colour.
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

const KEY = 'yard-theme';

function stored(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  const [theme, setState] = useState<Theme>(stored);

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return;
    // Following the device means following it as it changes, mid-shift.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      apply('system');
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice simply will not outlive the tab.
    }
    setState(next);
  }, []);

  return { theme, setTheme };
}
