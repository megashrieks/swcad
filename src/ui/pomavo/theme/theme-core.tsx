/**
 * Pure, SSR-safe theme core shared by every Pomavo host (web app, docs blog).
 *
 * This module owns *presentation* concerns only: light/dark mode, the active
 * color theme, resolved CSS variables, DOM application, and the plugin-theme
 * registry. It knows nothing about auth, orgs, or a backend.
 *
 * Persistence (localStorage, server preference sync, org switching, cross-tab)
 * is injected by each host through a {@link ThemePersistence} adapter, so the
 * same provider and `useTheme` hook work in the authenticated web app and in
 * the static, unauthenticated docs site alike.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import {
  resolveThemeColors,
  applyThemeToDOM,
  applyPluginThemeFont,
  getRegisteredPluginThemeIds,
  getPluginThemeName,
  getPluginThemeColor,
  type ThemeColors,
} from './theme-registry';

// Mode: light, dark, or system (follows OS preference)
export type Mode = 'light' | 'dark' | 'system';

// Color themes available - accent colors (full themes come from plugins)
export type ColorTheme = 'blue' | 'green' | 'orange' | 'rose' | 'violet' | (string & {});

/** A selectable color-theme entry surfaced in theme pickers. */
export interface ThemeColorOption {
  id: ColorTheme;
  name: string;
  description: string;
  color: string;
  group?: string;
}

// Theme pairs for auto-switching between light/dark modes.
// Plugin themes with variants use the `theme.` prefix check instead.
export const THEME_PAIRS: Record<string, { dark: string; light: string }> = {};

/** Default accent color themes shipped by the app. Hosts may pass their own. */
export const COLOR_THEMES: ThemeColorOption[] = [
  { id: 'blue', name: 'Blue', description: 'Blue accent', color: '#3b82f6', group: 'original' },
  { id: 'green', name: 'Green', description: 'Green accent', color: '#84cc16', group: 'original' },
  { id: 'orange', name: 'Orange', description: 'Orange accent', color: '#f97316', group: 'original' },
  { id: 'rose', name: 'Rose', description: 'Rose accent', color: '#f43f5e', group: 'original' },
  { id: 'violet', name: 'Violet', description: 'Violet accent', color: '#8b5cf6', group: 'original' },
];

export function isThemeWithVariants(themeKey: string): boolean {
  return Boolean(THEME_PAIRS[themeKey]) || themeKey.startsWith('theme.');
}

export interface ThemeContextType {
  mode: Mode;
  setMode: (mode: Mode) => void;
  resolvedMode: 'light' | 'dark';
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
  /** Current resolved theme color values (all keys). */
  themeColors: ThemeColors;
  /** All available color themes including installed plugin themes. */
  allColorThemes: ThemeColorOption[];
  /** Notify that plugin themes have been loaded. */
  notifyPluginThemesLoaded: () => void;
  /** Trigger a reload of installed plugin themes. */
  reloadPluginThemes: () => void;
  /** Loading state for async persistence sync. */
  isLoading: boolean;
  // Legacy compatibility aliases
  theme: Mode;
  setTheme: (mode: Mode) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | null>(null);

/** Snapshot of persisted theme preferences. */
export interface ThemePrefs {
  mode: Mode;
  colorTheme: ColorTheme;
}

/** Loosely-typed prefs where each field may be absent or undefined. */
export interface PartialThemePrefs {
  mode?: Mode | undefined;
  colorTheme?: ColorTheme | undefined;
}

/** Context handed to a persistence adapter's `usePersistence` hook. */
export interface ThemePersistenceContext {
  mode: Mode;
  colorTheme: ColorTheme;
  defaultMode: Mode;
  defaultColorTheme: ColorTheme;
  colorThemes: ThemeColorOption[];
  /** Apply externally-sourced prefs (e.g. from the server) WITHOUT re-persisting. */
  applyExternal: (prefs: PartialThemePrefs) => void;
}

/** What a persistence adapter's hook returns to the core. */
export interface ThemePersistenceResult {
  isLoading?: boolean;
  /** Persist a user-initiated change. Called by the core on every set. */
  save?: (prefs: ThemePrefs) => void;
}

/**
 * Host-injected persistence adapter. `getInitial` seeds first paint
 * synchronously (must be SSR-safe); `usePersistence` runs inside the provider
 * for side-effectful sync and returns the `save` handler + loading flag.
 */
export interface ThemePersistence {
  getInitial?: (defaults: ThemePrefs, colorThemes: ThemeColorOption[]) => PartialThemePrefs;
  usePersistence?: (ctx: ThemePersistenceContext) => ThemePersistenceResult | void;
}

interface ThemeProviderBaseProps {
  readonly children: ReactNode;
  readonly defaultMode?: Mode;
  readonly defaultColorTheme?: ColorTheme;
  /** Color themes offered to this host (defaults to the app accent set). */
  readonly colorThemes?: ThemeColorOption[];
  /** Optional persistence adapter (localStorage, server sync, etc.). */
  readonly persistence?: ThemePersistence;
}

const THEME_COLORS_CACHE_KEY = 'swcad.theme.colors';

const hasWindow = typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function';
const hasDocument = typeof document !== 'undefined';

function isValidMode(value: unknown): value is Mode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isValidColorTheme(value: unknown, colorThemes: ThemeColorOption[]): value is ColorTheme {
  return (
    typeof value === 'string' &&
    (colorThemes.some((t) => t.id === value) || value.startsWith('theme.'))
  );
}

function systemPrefersDark(): boolean {
  return hasWindow && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The pure theme provider. Combine with a {@link ThemePersistence} adapter to
 * add localStorage / server persistence without coupling this module to them.
 */
export function ThemeProviderBase({
  children,
  defaultMode = 'light',
  defaultColorTheme = 'blue',
  colorThemes = COLOR_THEMES,
  persistence,
}: ThemeProviderBaseProps) {
  // Seed initial preferences from the adapter once (SSR-safe: adapters guard storage).
  const [initial] = useState<PartialThemePrefs>(
    () => persistence?.getInitial?.({ mode: defaultMode, colorTheme: defaultColorTheme }, colorThemes) ?? {}
  );

  const [modeState, setModeState] = useState<Mode>(() =>
    isValidMode(initial.mode) ? initial.mode : defaultMode
  );
  const [colorThemeState, setColorThemeState] = useState<ColorTheme>(() =>
    isValidColorTheme(initial.colorTheme, colorThemes) ? initial.colorTheme : defaultColorTheme
  );

  const mode = modeState;
  const colorTheme = colorThemeState;

  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>(() => {
    if (modeState === 'system') return systemPrefersDark() ? 'dark' : 'light';
    return modeState;
  });

  const [pluginThemesLoaded, setPluginThemesLoaded] = useState(false);

  // Apply externally-sourced prefs (e.g. from a server fetch) without re-persisting.
  const applyExternal = useCallback(
    (prefs: PartialThemePrefs) => {
      if (isValidMode(prefs.mode)) setModeState(prefs.mode);
      if (isValidColorTheme(prefs.colorTheme, colorThemes)) setColorThemeState(prefs.colorTheme);
    },
    [colorThemes]
  );

  // Run the host persistence adapter (server sync, org handling, cross-tab, ...).
  const persistResult =
    persistence?.usePersistence?.({
      mode,
      colorTheme,
      defaultMode,
      defaultColorTheme,
      colorThemes,
      applyExternal,
    }) ?? undefined;
  const save = persistResult?.save;
  const isLoading = persistResult?.isLoading ?? false;

  const setMode = useCallback(
    (newMode: Mode) => {
      setModeState(newMode);
      save?.({ mode: newMode, colorTheme: colorThemeState });
    },
    [save, colorThemeState]
  );

  const setColorTheme = useCallback(
    (newTheme: ColorTheme) => {
      setColorThemeState(newTheme);
      save?.({ mode: modeState, colorTheme: newTheme });
    },
    [save, modeState]
  );

  const reloadPluginThemes = useCallback(() => {
    if (hasDocument) window.dispatchEvent(new Event('pomavo:reload-plugin-themes'));
  }, []);

  // Apply resolved light/dark mode to the DOM (client-only; effects don't run during SSG).
  useEffect(() => {
    const root = document.documentElement;

    const applyMode = (resolved: 'light' | 'dark') => {
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      setResolvedMode(resolved);
      if (isThemeWithVariants(colorTheme)) {
        root.dataset['colorTheme'] = `${colorTheme}-${resolved}`;
      }
    };

    if (mode === 'system') {
      const mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => applyMode(e.matches ? 'dark' : 'light');
      applyMode(mediaQuery.matches ? 'dark' : 'light');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    applyMode(mode);
    return undefined;
  }, [mode, colorTheme]);

  // Resolve + apply the color palette. Initial value is SSR-safe (no DOM writes on the server).
  const [themeColors, setThemeColors] = useState<ThemeColors>(() => {
    try {
      const cached = hasDocument ? localStorage.getItem(THEME_COLORS_CACHE_KEY) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as ThemeColors;
        if (hasDocument) applyThemeToDOM(parsed);
        return parsed;
      }
    } catch {
      /* ignore */
    }
    const colors = resolveThemeColors(colorTheme, resolvedMode === 'dark');
    if (hasDocument) applyThemeToDOM(colors);
    return colors;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset['colorTheme'] = isThemeWithVariants(colorTheme)
      ? `${colorTheme}-${resolvedMode}`
      : colorTheme;

    const colors = resolveThemeColors(colorTheme, resolvedMode === 'dark');
    applyThemeToDOM(colors);
    applyPluginThemeFont(colorTheme);
    setThemeColors(colors);
    try {
      localStorage.setItem(THEME_COLORS_CACHE_KEY, JSON.stringify(colors));
    } catch {
      /* ignore */
    }
  }, [colorTheme, resolvedMode]);

  const notifyPluginThemesLoaded = useCallback(() => {
    setPluginThemesLoaded((prev) => !prev);
    const colors = resolveThemeColors(colorTheme, resolvedMode === 'dark');
    if (hasDocument) applyThemeToDOM(colors);
    applyPluginThemeFont(colorTheme);
    setThemeColors(colors);
    try {
      localStorage.setItem(THEME_COLORS_CACHE_KEY, JSON.stringify(colors));
    } catch {
      /* ignore */
    }
  }, [colorTheme, resolvedMode]);

  // Combine the host's built-in themes with dynamically registered plugin themes.
  const allColorThemes = useMemo(() => {
    const pluginIds = getRegisteredPluginThemeIds();
    const pluginEntries = pluginIds
      .filter((id) => !colorThemes.some((t) => t.id === id))
      .map((id) => {
        const isVariant = id.includes('/');
        const parentId = isVariant ? (id.split('/')[0] ?? id) : id;
        const parentLabel = parentId
          .replace(/^theme\./, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const label = getPluginThemeName(id) ?? parentLabel;
        const group = isVariant ? `plugin:${parentId}` : 'plugins';
        const color = getPluginThemeColor(id) ?? '#888888';
        return {
          id: id as ColorTheme,
          name: label,
          description: `Plugin theme: ${parentLabel}`,
          color,
          group,
        };
      });
    return [...colorThemes, ...pluginEntries];
  }, [pluginThemesLoaded, colorThemes]); // eslint-disable-line react-hooks/exhaustive-deps

  const contextValue = useMemo(
    () => ({
      mode,
      setMode,
      resolvedMode,
      colorTheme,
      setColorTheme,
      themeColors,
      allColorThemes,
      notifyPluginThemesLoaded,
      reloadPluginThemes,
      isLoading,
      theme: mode,
      setTheme: setMode,
      resolvedTheme: resolvedMode,
    }),
    [
      mode,
      setMode,
      resolvedMode,
      colorTheme,
      setColorTheme,
      themeColors,
      allColorThemes,
      notifyPluginThemesLoaded,
      reloadPluginThemes,
      isLoading,
    ]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
