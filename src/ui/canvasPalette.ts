/**
 * Resolving the canvas palette to concrete colours.
 *
 * The SVG layers never need this — the browser resolves `var(--sw-*)` for them. Two
 * places do:
 *
 *  - the grid and highlight layers, which paint into a 2D canvas and so need a string
 *    `ctx.strokeStyle` will accept;
 *  - export, which writes a standalone file with no stylesheet attached.
 *
 * Reading `getPropertyValue('--sw-ink')` is not enough: for an unregistered custom
 * property the computed value is the substituted token stream, so a `color-mix(...)`
 * comes back as literal text. Assigning it to a real `color` property and reading that
 * back forces the colour to actually resolve, which is what the probe below does.
 */
import { useEffect, useState } from 'react';
import { ALL_PALETTE_VARS, type ResolvedPalette } from '@core/theme/palette';
import { useTheme } from './theme';

let probe: HTMLElement | null = null;
let normalizer: CanvasRenderingContext2D | null = null;

function getProbe(): HTMLElement {
  if (probe?.isConnected) return probe;
  probe = document.createElement('span');
  // Out of flow and unpainted, but still styled — `display: none` would do as well, we
  // only ever read `color`, which computes regardless.
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
  document.body.appendChild(probe);
  return probe;
}

/**
 * Reduce any CSS colour to its bytes, by painting one pixel and reading it back.
 *
 * A `color-mix()` computes to `color(srgb 0.12 0.14 0.17)`, which browsers understand but
 * an SVG opened in Inkscape or an older renderer does not — and these values end up in
 * exported files. Monaco is fussier still: it parses theme colours itself and takes only
 * hex. Painting a pixel is the only conversion that works for every colour syntax the
 * browser accepts, present and future.
 */
function toBytes(value: string): [number, number, number, number] | null {
  if (!normalizer) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    normalizer = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!normalizer) return null;
  normalizer.clearRect(0, 0, 1, 1);
  normalizer.fillStyle = value;
  normalizer.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = normalizer.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

function normalizeColor(value: string): string {
  if (/^#|^rgba?\(/i.test(value)) return value;
  const bytes = toBytes(value);
  if (!bytes) return value;
  const [r, g, b, a] = bytes;
  if (a === 255) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

/** Resolve one custom property against the live document, as `#rrggbb` / `#rrggbbaa`. */
export function readHexColor(cssVar: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') return fallback;
  const el = getProbe();
  el.style.color = '';
  el.style.color = `var(${cssVar})`;
  const computed = getComputedStyle(el).color;
  el.style.color = '';
  const bytes = computed ? toBytes(computed) : null;
  if (!bytes) return fallback;
  const [r, g, b, a] = bytes;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? '' : hex2(a)}`;
}

/**
 * Resolve every palette token against the document's current theme.
 *
 * One forced style recalc per token, but this only runs when the theme changes, so it is
 * a handful of microseconds a few times per session.
 */
export function readCanvasPalette(): ResolvedPalette {
  if (typeof document === 'undefined') return {};
  const el = getProbe();
  const out: Record<string, string> = {};
  for (const name of ALL_PALETTE_VARS) {
    el.style.color = '';
    el.style.color = `var(${name})`;
    const value = getComputedStyle(el).color;
    if (value) out[name] = normalizeColor(value);
  }
  el.style.color = '';
  return out;
}

/** The palette for the active theme, recomputed whenever the theme or mode changes. */
export function useCanvasPalette(): ResolvedPalette {
  const { colorTheme, resolvedMode } = useTheme();
  const [palette, setPalette] = useState<ResolvedPalette>(() => readCanvasPalette());

  useEffect(() => {
    // The provider writes the new `--color-*` values in its own effect; reading on the
    // next frame guarantees we are looking at the theme that just landed.
    const id = requestAnimationFrame(() => setPalette(readCanvasPalette()));
    return () => cancelAnimationFrame(id);
  }, [colorTheme, resolvedMode]);

  return palette;
}

/** Look a token up with a sane fallback, so a missing property can never paint nothing. */
export function paletteColor(palette: ResolvedPalette, cssVar: string, fallback: string): string {
  return palette[cssVar] || fallback;
}
