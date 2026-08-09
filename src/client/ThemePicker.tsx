import type { ReactElement } from 'react';
import { THEMES, useTheme, type Theme } from './theme';
import { AR } from './ar';

const GLYPH: Record<Theme, string> = { light: '☀', dark: '☾', system: '◐' };
const NAME: Record<Theme, string> = {
  light: AR.themeLight,
  dark: AR.themeDark,
  system: AR.themeSystem,
};

/** Three states in one small control: light, dark, or whatever the device says. */
export function ThemePicker(): ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className="flex overflow-hidden rounded-xl border border-line-strong"
      role="group"
      aria-label={AR.themeLabel}
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          title={NAME[option]}
          aria-label={NAME[option]}
          aria-pressed={theme === option}
          onClick={() => {
            setTheme(option);
          }}
          className={
            'px-2.5 py-1.5 text-sm transition-colors ' +
            (theme === option
              ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
              : 'bg-surface text-muted hover:bg-sunken')
          }
        >
          {GLYPH[option]}
        </button>
      ))}
    </div>
  );
}
