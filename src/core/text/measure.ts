/**
 * Text measurement.
 *
 * A drawn label's box decides what you can hover, select and drag, so it has to be the box
 * the browser actually paints — estimating an average glyph width put the box visibly off
 * for anything but lowercase prose. Canvas reports the same metrics the SVG text layout
 * uses, so measuring there and drawing in SVG agree.
 *
 * The estimate survives as a fallback for headless use (the compiler resolves a document
 * without a DOM), where nothing is being hovered anyway.
 */

export interface FontSpec {
  family: string;
  size: number;
  weight: string;
  style: string;
  letterSpacing: number;
}

/** Rough advance width per character, as a fraction of the font size. */
const GLYPH_RATIO = 0.58;
const ASCENT_RATIO = 0.8;
const DESCENT_RATIO = 0.2;
/** Enough for a busy sheet; cleared wholesale rather than evicted one by one. */
const CACHE_LIMIT = 4000;

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = typeof document === 'undefined' ? null : (document.createElement('canvas').getContext('2d') ?? null);
  return ctx;
}

export function fontString(font: FontSpec): string {
  return `${font.style || 'normal'} ${font.weight || '400'} ${font.size}px ${font.family}`;
}

const widths = new Map<string, number>();

/** Advance width of a single line, letter-spacing included. */
export function measureWidth(text: string, font: FontSpec): number {
  if (!text) return 0;
  const key = `${fontString(font)}|${font.letterSpacing}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  let width: number;
  if (c) {
    c.font = fontString(font);
    // Letter-spacing is an SVG attribute the canvas font string cannot carry, so it is
    // added back per glyph — the same thing the renderer does.
    width = c.measureText(text).width + font.letterSpacing * text.length;
  } else {
    width = text.length * (font.size * GLYPH_RATIO + font.letterSpacing);
  }
  if (widths.size > CACHE_LIMIT) widths.clear();
  widths.set(key, width);
  return width;
}

const verticals = new Map<string, { ascent: number; descent: number }>();

/** How far the font reaches above and below the baseline. */
export function measureVertical(font: FontSpec): { ascent: number; descent: number } {
  const key = fontString(font);
  const hit = verticals.get(key);
  if (hit) return hit;
  const c = context();
  let out = { ascent: font.size * ASCENT_RATIO, descent: font.size * DESCENT_RATIO };
  if (c) {
    c.font = key;
    const m = c.measureText('Hxgq');
    if (Number.isFinite(m.fontBoundingBoxAscent) && Number.isFinite(m.fontBoundingBoxDescent)) {
      out = { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
    }
  }
  if (verticals.size > CACHE_LIMIT) verticals.clear();
  verticals.set(key, out);
  return out;
}

/**
 * `text` as a component script sees it.
 *
 * A script that draws its own caption has to know how wide the words will be — to size a
 * box around them, or to cut a gap in a line for them. Guessing an average glyph width is
 * off by a third on anything but lowercase prose, and the guess is baked into the drawing,
 * so the mistake is visible. This measures with the same canvas the renderer's layout does.
 */
export const scriptTextApi = Object.freeze({
  measure(
    value: unknown,
    font?: { family?: string; size?: number; weight?: string | number; style?: string; letterSpacing?: number },
  ): { width: number; ascent: number; descent: number; height: number } {
    const size = Number(font?.size);
    const spec: FontSpec = {
      family: font?.family ?? 'Inter, Segoe UI, sans-serif',
      size: Number.isFinite(size) && size > 0 ? size : 12,
      weight: String(font?.weight ?? '400'),
      style: font?.style ?? 'normal',
      letterSpacing: Number(font?.letterSpacing) || 0,
    };
    const vertical = measureVertical(spec);
    return {
      width: measureWidth(value === undefined || value === null ? '' : String(value), spec),
      ascent: vertical.ascent,
      descent: vertical.descent,
      height: vertical.ascent + vertical.descent,
    };
  },
});
