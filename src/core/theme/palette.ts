/**
 * The canvas palette: the colours a component is allowed to borrow from the active theme.
 *
 * A component that hardcodes `#2e3440` keeps `#2e3440` forever — that is deliberate, and
 * nothing here rewrites it. A component that instead writes `var(--sw-ink)` gets whatever
 * the current theme calls "ink", so it follows Ayu Dark, Ayu Mirage, an accent theme or a
 * light/dark flip without being touched.
 *
 * The tokens are real CSS custom properties, declared in `src/ui/theme.css` on top of
 * Pomavo's `--color-*` set. Browsers resolve `var()` inside SVG presentation attributes,
 * so on screen this costs nothing: the attribute is written through verbatim and the
 * engine paints it. Only an export has to do work, because a standalone SVG file carries
 * no stylesheet — see `resolveThemeColorsIn`.
 */

export interface PaletteToken {
  /** The short name used in the picker and in docs, e.g. `ink`. */
  readonly id: string;
  /** The CSS custom property, e.g. `--sw-ink`. */
  readonly cssVar: string;
  readonly label: string;
  readonly group: 'surface' | 'ink' | 'accent' | 'series';
  readonly hint: string;
}

const token = (
  id: string,
  label: string,
  group: PaletteToken['group'],
  hint: string,
): PaletteToken => ({ id, cssVar: `--sw-${id}`, label, group, hint });

/**
 * Ordered so the picker reads top to bottom: what you paint on, what you paint with,
 * then the accents and the categorical series.
 */
export const PALETTE_TOKENS: readonly PaletteToken[] = Object.freeze([
  token('paper', 'Paper', 'surface', 'The drawing surface itself.'),
  token('surface', 'Surface', 'surface', 'Default body fill — a card sitting on the paper.'),
  token('surface-2', 'Surface alt', 'surface', 'A second fill, for notes and callouts.'),
  token('ink', 'Ink', 'ink', 'Default stroke and text.'),
  token('ink-muted', 'Ink muted', 'ink', 'Secondary text and annotations.'),
  token('line', 'Line', 'ink', 'Hairlines, frames and table rules.'),
  token('accent', 'Accent', 'accent', "The theme's primary colour."),
  token('accent-2', 'Accent 2', 'accent', 'A cooler companion to the accent.'),
  token('success', 'Success', 'accent', 'Good state — connected, valid, passing.'),
  token('warning', 'Warning', 'accent', 'Caution state.'),
  token('danger', 'Danger', 'accent', 'Error state — broken links, invalid input.'),
  token('port', 'Port', 'accent', 'Port glyphs and connection endpoints.'),
  token('1', 'Series 1', 'series', 'Categorical colour 1.'),
  token('2', 'Series 2', 'series', 'Categorical colour 2.'),
  token('3', 'Series 3', 'series', 'Categorical colour 3.'),
  token('4', 'Series 4', 'series', 'Categorical colour 4.'),
  token('5', 'Series 5', 'series', 'Categorical colour 5.'),
]);

/** Extra tokens the editor paints with that are not offered to components. */
export const CHROME_TOKENS: readonly string[] = Object.freeze([
  '--sw-grid-minor',
  '--sw-grid-major',
  '--sw-grid-axis',
  '--sw-highlight',
  '--sw-guide',
  '--sw-guide-weak',
  '--sw-frame',
  '--sw-zone',
  '--sw-selection',
]);

/** Every custom property `readCanvasPalette` should resolve. */
export const ALL_PALETTE_VARS: readonly string[] = Object.freeze([
  ...PALETTE_TOKENS.map((t) => t.cssVar),
  ...CHROME_TOKENS,
]);

/** Resolved colour per CSS custom property name, e.g. `{'--sw-ink': 'rgb(191, 189, 182)'}`. */
export type ResolvedPalette = Readonly<Record<string, string>>;

const TOKEN_BY_VAR = new Map(PALETTE_TOKENS.map((t) => [t.cssVar, t]));

export function paletteToken(cssVar: string): PaletteToken | null {
  return TOKEN_BY_VAR.get(cssVar) ?? null;
}

/** `var(--sw-ink)` or `var(--sw-ink, #333)`, with any spacing. */
const THEME_VAR_RE = /var\(\s*(--sw-[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/gi;

/** True when the value borrows from the theme rather than naming a fixed colour. */
export function isThemeColor(value: string | null | undefined): boolean {
  if (!value) return false;
  THEME_VAR_RE.lastIndex = 0;
  return THEME_VAR_RE.test(value);
}

/** The token id inside a `var(--sw-*)` value, or null when the value is a fixed colour. */
export function themeColorId(value: string | null | undefined): string | null {
  if (!value) return null;
  THEME_VAR_RE.lastIndex = 0;
  const m = THEME_VAR_RE.exec(value);
  return m ? m[1].slice('--sw-'.length) : null;
}

/** Build the `var()` reference for a token id. */
export function themeColorRef(id: string): string {
  return `var(--sw-${id})`;
}

/**
 * Substitute every `var(--sw-*)` in a string with its resolved colour.
 *
 * Unknown tokens fall back to the value written inside the `var()`, and failing that to
 * `fallback` — an export should never emit a literal `var(...)`, because outside the app
 * there is nothing to resolve it against and the shape silently turns black.
 */
export function resolveThemeColorsIn(
  value: string,
  palette: ResolvedPalette,
  fallback = 'currentColor',
): string {
  if (!value.includes('--sw-')) return value;
  return value.replace(THEME_VAR_RE, (_all, name: string, inner?: string) => {
    const hit = palette[name];
    if (hit) return hit;
    const declared = inner?.trim();
    return declared && declared.length > 0 ? declared : fallback;
  });
}
