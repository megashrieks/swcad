/**
 * swcad's host wiring for Pomavo's theme core.
 *
 * The upstream `ThemeContext` binds the provider to react-router and Pomavo's
 * preferences API; swcad is a single-window local tool, so persistence is plain
 * localStorage and the theme list is the two built-in Ayu palettes plus the five
 * accent themes.
 */
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import {
  BUILTIN_THEME_META,
  COLOR_THEMES,
  ThemeProviderBase,
  useTheme,
  type ColorTheme,
  type Mode,
  type PartialThemePrefs,
  type ThemeColorOption,
  type ThemePersistence,
  type ThemePrefs,
} from './pomavo';

export { useTheme };
export type { ColorTheme, Mode };

const STORE_KEY = 'swcad.theme';

/** Ayu first — swcad ships on Ayu Dark — then the neutral accent themes. */
export const SWCAD_THEMES: ThemeColorOption[] = [
  ...Object.entries(BUILTIN_THEME_META).map(([id, meta]) => ({
    id,
    name: meta.name,
    description: `${meta.name} palette`,
    color: meta.color,
    group: 'ayu',
  })),
  ...COLOR_THEMES,
];

export const DEFAULT_THEME: ColorTheme = 'ayu-dark';
export const DEFAULT_MODE: Mode = 'dark';

function read(): PartialThemePrefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PartialThemePrefs;
    return { mode: parsed.mode, colorTheme: parsed.colorTheme };
  } catch {
    return {};
  }
}

const persistence: ThemePersistence = {
  getInitial: () => read(),
  usePersistence: () => ({
    save: (prefs: ThemePrefs) => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
      } catch {
        /* private mode, quota — the theme just does not survive a reload */
      }
    },
  }),
};

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  return (
    <ThemeProviderBase
      defaultMode={DEFAULT_MODE}
      defaultColorTheme={DEFAULT_THEME}
      colorThemes={SWCAD_THEMES}
      persistence={persistence}
    >
      {children}
    </ThemeProviderBase>
  );
}

/** The themes to offer, grouped for the picker. */
export function useThemeOptions(): { ayu: ThemeColorOption[]; accents: ThemeColorOption[] } {
  const { allColorThemes } = useTheme();
  return useMemo(
    () => ({
      ayu: allColorThemes.filter((t) => t.group === 'ayu'),
      accents: allColorThemes.filter((t) => t.group !== 'ayu'),
    }),
    [allColorThemes],
  );
}

/** Cycles light → dark → system, which is all the toolbar button needs. */
export function useModeCycle(): [Mode, () => void] {
  const { mode, setMode } = useTheme();
  const cycle = useCallback(() => {
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light');
  }, [mode, setMode]);
  return [mode, cycle];
}
