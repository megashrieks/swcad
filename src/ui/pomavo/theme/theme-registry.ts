// ---------------------------------------------------------------------------
// Theme Registry – single source of truth for every UI theme color
// ---------------------------------------------------------------------------

/** All 33 theme color keys used across the application. */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  primary: string;
  primaryForeground: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarRing: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

/** The 33 CSS variable names (with `--color-` prefix) in canonical order. */
export const ALL_THEME_COLORS: string[] = [
  '--color-background',
  '--color-foreground',
  '--color-card',
  '--color-card-foreground',
  '--color-popover',
  '--color-popover-foreground',
  '--color-secondary',
  '--color-secondary-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-accent',
  '--color-accent-foreground',
  '--color-destructive',
  '--color-destructive-foreground',
  '--color-border',
  '--color-input',
  '--color-primary',
  '--color-primary-foreground',
  '--color-ring',
  '--color-sidebar',
  '--color-sidebar-foreground',
  '--color-sidebar-accent',
  '--color-sidebar-accent-foreground',
  '--color-sidebar-border',
  '--color-sidebar-primary',
  '--color-sidebar-primary-foreground',
  '--color-sidebar-ring',
  '--color-chart-1',
  '--color-chart-2',
  '--color-chart-3',
  '--color-chart-4',
  '--color-chart-5',
];

/** Maps every CSS variable name to its `ThemeColors` key. */
export const CSS_VAR_TO_KEY: Record<string, keyof ThemeColors> = {
  '--color-background': 'background',
  '--color-foreground': 'foreground',
  '--color-card': 'card',
  '--color-card-foreground': 'cardForeground',
  '--color-popover': 'popover',
  '--color-popover-foreground': 'popoverForeground',
  '--color-secondary': 'secondary',
  '--color-secondary-foreground': 'secondaryForeground',
  '--color-muted': 'muted',
  '--color-muted-foreground': 'mutedForeground',
  '--color-accent': 'accent',
  '--color-accent-foreground': 'accentForeground',
  '--color-destructive': 'destructive',
  '--color-destructive-foreground': 'destructiveForeground',
  '--color-border': 'border',
  '--color-input': 'input',
  '--color-primary': 'primary',
  '--color-primary-foreground': 'primaryForeground',
  '--color-ring': 'ring',
  '--color-sidebar': 'sidebar',
  '--color-sidebar-foreground': 'sidebarForeground',
  '--color-sidebar-accent': 'sidebarAccent',
  '--color-sidebar-accent-foreground': 'sidebarAccentForeground',
  '--color-sidebar-border': 'sidebarBorder',
  '--color-sidebar-primary': 'sidebarPrimary',
  '--color-sidebar-primary-foreground': 'sidebarPrimaryForeground',
  '--color-sidebar-ring': 'sidebarRing',
  '--color-chart-1': 'chart1',
  '--color-chart-2': 'chart2',
  '--color-chart-3': 'chart3',
  '--color-chart-4': 'chart4',
  '--color-chart-5': 'chart5',
};

// ---------------------------------------------------------------------------
// 3. Base palettes (zinc neutral) – from base.css :root / :root.dark
// ---------------------------------------------------------------------------

/** Base light palette (zinc) – does NOT include primary/ring/sidebar-primary. */
export const BASE_LIGHT: ThemeColors = {
  background: '#fafafa',
  foreground: '#09090b',
  card: '#ffffff',
  cardForeground: '#09090b',
  popover: '#ffffff',
  popoverForeground: '#09090b',
  secondary: '#f4f4f5',
  secondaryForeground: '#18181b',
  muted: '#f4f4f5',
  mutedForeground: '#71717a',
  accent: '#f4f4f5',
  accentForeground: '#18181b',
  destructive: '#ef4444',
  destructiveForeground: '#fafafa',
  border: '#e4e4e7',
  input: '#e4e4e7',
  primary: '#2563eb',
  primaryForeground: '#eff6ff',
  ring: '#3b82f6',
  sidebar: '#fafafa',
  sidebarForeground: '#09090b',
  sidebarAccent: '#f4f4f5',
  sidebarAccentForeground: '#18181b',
  sidebarBorder: '#e4e4e7',
  sidebarPrimary: '#2563eb',
  sidebarPrimaryForeground: '#eff6ff',
  sidebarRing: '#3b82f6',
  chart1: '#e76e50',
  chart2: '#2a9d90',
  chart3: '#274754',
  chart4: '#e8c468',
  chart5: '#f4a462',
};

/** Base dark palette (zinc). */
export const BASE_DARK: ThemeColors = {
  background: '#09090b',
  foreground: '#fafafa',
  card: '#09090b',
  cardForeground: '#fafafa',
  popover: '#09090b',
  popoverForeground: '#fafafa',
  secondary: '#27272a',
  secondaryForeground: '#fafafa',
  muted: '#27272a',
  mutedForeground: '#a1a1aa',
  accent: '#27272a',
  accentForeground: '#fafafa',
  destructive: '#f87171',
  destructiveForeground: '#450a0a',
  border: '#27272a',
  input: '#27272a',
  primary: '#3b82f6',
  primaryForeground: '#eff6ff',
  ring: '#1d4ed8',
  sidebar: '#09090b',
  sidebarForeground: '#fafafa',
  sidebarAccent: '#27272a',
  sidebarAccentForeground: '#fafafa',
  sidebarBorder: '#27272a',
  sidebarPrimary: '#3b82f6',
  sidebarPrimaryForeground: '#eff6ff',
  sidebarRing: '#1d4ed8',
  chart1: '#2662d9',
  chart2: '#2eb88a',
  chart3: '#e88c30',
  chart4: '#af57db',
  chart5: '#e23670',
};

// ---------------------------------------------------------------------------
// 4. Accent-only type (6 keys overridden per accent color)
// ---------------------------------------------------------------------------

export type AccentColors = Pick<
  ThemeColors,
  | 'primary'
  | 'primaryForeground'
  | 'ring'
  | 'sidebarPrimary'
  | 'sidebarPrimaryForeground'
  | 'sidebarRing'
>;

// ---------------------------------------------------------------------------
// 5. Accent definitions – light & dark
// ---------------------------------------------------------------------------

function accent(primary: string, primaryFg: string, ring: string): AccentColors {
  return {
    primary,
    primaryForeground: primaryFg,
    ring,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: primaryFg,
    sidebarRing: ring,
  };
}

export const ACCENT_LIGHT: Record<string, AccentColors> = {
  blue: accent('#2563eb', '#eff6ff', '#3b82f6'),
  green: accent('#65a30d', '#f7fee7', '#84cc16'),
  orange: accent('#ea580c', '#fff7ed', '#f97316'),
  rose: accent('#e11d48', '#fff1f2', '#f43f5e'),
  violet: accent('#7c3aed', '#f5f3ff', '#8b5cf6'),
};

export const ACCENT_DARK: Record<string, AccentColors> = {
  blue: accent('#3b82f6', '#eff6ff', '#1d4ed8'),
  green: accent('#84cc16', '#f7fee7', '#4d7c0f'),
  orange: accent('#f97316', '#fff7ed', '#c2410c'),
  rose: accent('#f43f5e', '#fff1f2', '#be123c'),
  violet: accent('#8b5cf6', '#f5f3ff', '#6d28d9'),
};

// ---------------------------------------------------------------------------
// 6. Theme seed -> full ThemeColors expansion
// ---------------------------------------------------------------------------
//
// Every theme follows a highly regular structure where ~15 of the 33 properties
// are always derived from the other ~18. The `theme()` function encodes these
// invariants so each theme definition only specifies its unique values.
//
// Invariants (verified across all themes):
//   cardForeground = foreground          sidebarForeground = foreground
//   popoverForeground = foreground       sidebarAccentForeground = foreground
//   secondaryForeground = foreground     sidebarPrimary = primary
//   muted = secondary                    sidebarPrimaryForeground = primaryForeground
//   input = border                       sidebarRing = primary
//   ring = primary
//
// Near-invariants (overridable via optional fields):
//   accent = secondary                   sidebarAccent = secondary
//   accentForeground = foreground        sidebarBorder = border

type Charts = [string, string, string, string, string];

interface ThemeSeed {
  bg: string;
  fg: string;
  card: string;
  popover: string;
  secondary: string;
  mutedFg: string;
  destructive: string;
  destructiveFg: string;
  border: string;
  primary: string;
  primaryFg: string;
  sidebar: string;
  charts: Charts;
  accent?: string;
  accentFg?: string;
  sidebarAccent?: string;
  sidebarBorder?: string;
}

function theme(s: ThemeSeed): ThemeColors {
  return {
    background: s.bg,
    foreground: s.fg,
    card: s.card,
    cardForeground: s.fg,
    popover: s.popover,
    popoverForeground: s.fg,
    secondary: s.secondary,
    secondaryForeground: s.fg,
    muted: s.secondary,
    mutedForeground: s.mutedFg,
    accent: s.accent ?? s.secondary,
    accentForeground: s.accentFg ?? s.fg,
    destructive: s.destructive,
    destructiveForeground: s.destructiveFg,
    border: s.border,
    input: s.border,
    primary: s.primary,
    primaryForeground: s.primaryFg,
    ring: s.primary,
    sidebar: s.sidebar,
    sidebarForeground: s.fg,
    sidebarAccent: s.sidebarAccent ?? s.secondary,
    sidebarAccentForeground: s.fg,
    sidebarBorder: s.sidebarBorder ?? s.border,
    sidebarPrimary: s.primary,
    sidebarPrimaryForeground: s.primaryFg,
    sidebarRing: s.primary,
    chart1: s.charts[0],
    chart2: s.charts[1],
    chart3: s.charts[2],
    chart4: s.charts[3],
    chart5: s.charts[4],
  };
}

// ---------------------------------------------------------------------------
// Built-in named themes (full palettes, not just accents)
// ---------------------------------------------------------------------------

/** Display metadata for built-in named themes (used by theme switchers). */
export const BUILTIN_THEME_META: Record<string, { name: string; color: string }> = {
  'ayu-mirage': { name: 'Ayu Mirage', color: '#ffcc66' },
  'ayu-dark': { name: 'Ayu Dark', color: '#e6b450' },
};

/** Full color palettes for built-in named themes, keyed by `${id}-${dark|light}`. */
export const BUILTIN_THEMES: Record<string, ThemeColors> = {
  'ayu-mirage-dark': theme({
    bg: '#1f2430', fg: '#cbccc6', card: '#232834', popover: '#232834',
    secondary: '#2d3445', mutedFg: '#707a8c', destructive: '#f28779', destructiveFg: '#1f2430',
    border: '#33415e', primary: '#ffcc66', primaryFg: '#1f2430', sidebar: '#1a1f29',
    charts: ['#73d0ff', '#bae67e', '#ffcc66', '#d4bfff', '#f28779'],
  }),
  'ayu-mirage-light': theme({
    bg: '#fcfcfc', fg: '#5c6166', card: '#f8f9fa', popover: '#fafafa',
    secondary: '#f0f1f2', mutedFg: '#828e9f', destructive: '#e65050', destructiveFg: '#fcfcfc',
    border: '#e8e9eb', primary: '#f29718', primaryFg: '#fcfcfc', sidebar: '#f8f9fa',
    charts: ['#22a4e6', '#86b300', '#f29718', '#a37acc', '#f07171'],
  }),
  'ayu-dark-dark': theme({
    bg: '#0d1017', fg: '#bfbdb6', card: '#141821', popover: '#141821',
    secondary: '#1b1f29', mutedFg: '#5a6378', destructive: '#d95757', destructiveFg: '#0d1017',
    border: '#1b1f29', primary: '#e6b450', primaryFg: '#0d1017', sidebar: '#0a0d12',
    charts: ['#59c2ff', '#aad94c', '#e6b450', '#d2a6ff', '#f07178'],
  }),
  'ayu-dark-light': theme({
    bg: '#fafafa', fg: '#575f66', card: '#f3f4f5', popover: '#f5f6f7',
    secondary: '#e8eaeb', mutedFg: '#8a919a', destructive: '#f07178', destructiveFg: '#fafafa',
    border: '#d8dadc', primary: '#e6b450', primaryFg: '#1a1f29', sidebar: '#f3f4f5',
    charts: ['#59c2ff', '#aad94c', '#e6b450', '#d2a6ff', '#f07178'],
  }),
};

// ---------------------------------------------------------------------------
// Plugin theme registry — dynamically populated from installed theme plugins
// ---------------------------------------------------------------------------

const PLUGIN_THEMES: Record<string, ThemeColors> = {};
const PLUGIN_THEME_NAMES: Record<string, string> = {};
const PLUGIN_THEME_COLORS: Record<string, string> = {};
const PLUGIN_THEME_FONTS: Record<string, { sans?: string; mono?: string }> = {};

/**
 * Register a theme plugin's colors. Called during app initialization
 * with data from installed plugin manifests.
 * @param themeId Plugin theme ID (e.g., "theme.nord" or "theme.ayu/dark")
 * @param darkSeed ThemeSeed for dark mode
 * @param lightSeed ThemeSeed for light mode
 * @param displayName Optional display name for the theme
 */
export function registerPluginTheme(
  themeId: string,
  darkSeed: Record<string, string | string[]>,
  lightSeed: Record<string, string | string[]>,
  displayName?: string,
  font?: { sans?: string; mono?: string }
): void {
  PLUGIN_THEMES[`${themeId}-dark`] = theme(darkSeed as unknown as ThemeSeed);
  PLUGIN_THEMES[`${themeId}-light`] = theme(lightSeed as unknown as ThemeSeed);
  if (displayName) {
    PLUGIN_THEME_NAMES[themeId] = displayName;
  }
  const primary = darkSeed['primary'];
  if (typeof primary === 'string') {
    PLUGIN_THEME_COLORS[themeId] = primary;
  }
  if (font) {
    PLUGIN_THEME_FONTS[themeId] = font;
  }
}

/**
 * Get all registered plugin theme IDs (without -dark/-light suffix).
 */
export function getRegisteredPluginThemeIds(): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(PLUGIN_THEMES)) {
    ids.add(key.replace(/-dark$|-light$/, ''));
  }
  return [...ids];
}

/**
 * Get the display name for a registered plugin theme.
 */
export function getPluginThemeName(themeId: string): string | undefined {
  return PLUGIN_THEME_NAMES[themeId];
}

/**
 * Get the primary color for a registered plugin theme (for theme switcher dot).
 */
export function getPluginThemeColor(themeId: string): string | undefined {
  return PLUGIN_THEME_COLORS[themeId];
}

/**
 * Apply plugin theme fonts to the DOM. Call after resolving a plugin theme.
 */
export function applyPluginThemeFont(themeId: string): void {
  const style = document.documentElement.style;
  const font = PLUGIN_THEME_FONTS[themeId];
  if (font?.sans) {
    style.setProperty('--font-sans', font.sans);
  } else {
    style.removeProperty('--font-sans');
  }
  if (font?.mono) {
    style.setProperty('--font-mono', font.mono);
  } else {
    style.removeProperty('--font-mono');
  }
}

// ---------------------------------------------------------------------------
// Resolve theme colors at runtime
// ---------------------------------------------------------------------------

const ACCENT_NAMES = new Set(['blue', 'green', 'orange', 'rose', 'violet']);

/**
 * Resolve the full set of 33 theme colors for a given `colorTheme` + dark/light mode.
 *
 * - Accent themes (blue/green/orange/rose/violet): merges BASE with accent overrides.
 * - Plugin themes: checks dynamically registered plugin themes.
 * - Falls back to BASE + blue accent when the key is unrecognised.
 */
export function resolveThemeColors(colorTheme: string, isDark: boolean): ThemeColors {
  // 1. Accent themes
  if (ACCENT_NAMES.has(colorTheme)) {
    const base = isDark ? BASE_DARK : BASE_LIGHT;
    const accents = isDark ? ACCENT_DARK : ACCENT_LIGHT;
    return { ...base, ...accents[colorTheme] };
  }

  const suffix = isDark ? 'dark' : 'light';

  // 2. Built-in named themes (full palettes)
  const builtin = BUILTIN_THEMES[`${colorTheme}-${suffix}`];
  if (builtin) {
    return builtin;
  }

  // 3. Plugin themes
  const resolved = `${colorTheme}-${suffix}`;

  if (PLUGIN_THEMES[resolved]) {
    return PLUGIN_THEMES[resolved];
  }
  if (PLUGIN_THEMES[colorTheme]) {
    return PLUGIN_THEMES[colorTheme];
  }

  // 4. Fallback: base + blue accent
  const base = isDark ? BASE_DARK : BASE_LIGHT;
  const accents = isDark ? ACCENT_DARK : ACCENT_LIGHT;
  return { ...base, ...accents['blue'] };
}

// ---------------------------------------------------------------------------
// 8. Apply theme colors to the DOM
// ---------------------------------------------------------------------------

/**
 * Write all 33 CSS custom properties onto `document.documentElement.style`.
 */
export function applyThemeToDOM(colors: ThemeColors): void {
  const style = document.documentElement.style;
  for (const cssVar of ALL_THEME_COLORS) {
    const key = CSS_VAR_TO_KEY[cssVar];
    if (key) {
      style.setProperty(cssVar, colors[key]);
    }
  }
}

/** Optional font families supplied by the host alongside a theme. */
export interface ThemeFonts {
  sans?: string;
  mono?: string;
}

/**
 * Apply theme colors inside an iframe panel.
 * Sets all --color-* CSS variables, overrides background to transparent,
 * and applies font families if provided.
 */
export function applyThemeForIframe(
  colors: Record<string, string>,
  fonts?: ThemeFonts,
): void {
  const root = document.documentElement;
  const style = root.style;

  for (const cssVar of ALL_THEME_COLORS) {
    const key = CSS_VAR_TO_KEY[cssVar];
    if (key && colors[key]) {
      style.setProperty(cssVar, colors[key]);
    }
  }

  // Iframe background should be transparent so host controls it
  style.setProperty('--color-background', 'transparent');

  if (fonts?.sans) document.body.style.fontFamily = fonts.sans;
  if (fonts?.mono) style.setProperty('--font-mono', fonts.mono);
}
