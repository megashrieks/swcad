/**
 * A small Markdown subset, laid out as SVG `<tspan>`s.
 *
 * Text on a drawing is prose, and prose wants emphasis, a bullet list and the occasional
 * heading far more often than it wants a colour picker. Markdown is the shortest way to
 * say all of that in a box you type into, so a text element carries a `label` annotation
 * with `markdown: true` and its content is parsed here.
 *
 * Everything is positioned explicitly: each run gets its own `x` and `y`, so nothing
 * depends on how SVG collapses whitespace between adjacent spans, and the block's measured
 * box is exactly the box that gets drawn.
 *
 * Supported: `#`..`######` headings, `-`/`*`/`+` bullets, `1.` ordered items, `>` quotes,
 * ``` fences, and inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` with `\` escapes.
 */

import type { Rect } from '../geometry/index';
import { rect } from '../geometry/index';
import type { VNode } from '../script/svg';
import { measureVertical, measureWidth, type FontSpec } from './measure';

export interface MdRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}

interface MdBlock {
  runs: MdRun[];
  /** Font size multiplier: headings are bigger, everything else is 1. */
  scale: number;
  bold: boolean;
  /** Leading indent in em, for nested list items and quotes. */
  indent: number;
  /** Bullet or number drawn before the first run, at the indent. */
  marker: string;
  /** A fenced code line: monospaced and taken verbatim. */
  code: boolean;
  quote: boolean;
}

export interface TextStyle {
  family: string;
  monoFamily: string;
  size: number;
  weight: string;
  style: string;
  letterSpacing: number;
  color: string;
}

export interface LaidRun {
  text: string;
  x: number;
  attrs: Record<string, string>;
}

export interface LaidLine {
  /** Baseline, relative to the top of the block. */
  y: number;
  runs: LaidRun[];
}

export interface MdLayout {
  width: number;
  height: number;
  lines: LaidLine[];
}

const HEADING_SCALE = [1.75, 1.5, 1.3, 1.15, 1.05, 1];
/** Baseline-to-baseline distance, as a multiple of the line's own font size. */
const LINE_SPACING = 1.35;
/** A blank line is a paragraph break, not a full empty line of text. */
const BLANK_SPACING = 0.6;
const INDENT_EM = 1.5;
const QUOTE_BAR = '\u2503';
const BULLETS = ['\u2022', '\u25e6', '\u25aa'];

// ------------------------------------------------------------------- parsing

/** Split one line of body text into styled runs. */
function parseInline(src: string): MdRun[] {
  const runs: MdRun[] = [];
  let plain = '';
  let i = 0;
  const flush = (): void => {
    if (plain) runs.push({ text: plain });
    plain = '';
  };
  const emphasis = (marker: string, key: 'bold' | 'italic' | 'strike'): boolean => {
    const end = src.indexOf(marker, i + marker.length);
    if (end < 0 || end === i + marker.length) return false;
    flush();
    for (const run of parseInline(src.slice(i + marker.length, end))) runs.push({ ...run, [key]: true });
    i = end + marker.length;
    return true;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        runs.push({ text: src.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith('**', i) && emphasis('**', 'bold')) continue;
    if (src.startsWith('__', i) && emphasis('__', 'bold')) continue;
    if (src.startsWith('~~', i) && emphasis('~~', 'strike')) continue;
    if ((ch === '*' || ch === '_') && emphasis(ch, 'italic')) continue;
    plain += ch;
    i += 1;
  }
  flush();
  return runs;
}

/** Split a markdown source into per-line blocks. A blank line stays as an empty block. */
export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  let fenced = false;
  for (const raw of src.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push({ runs: [{ text: raw, code: true }], scale: 1, bold: false, indent: 0, marker: '', code: true, quote: false });
      continue;
    }
    let line = raw;
    let indent = 0;
    let quote = false;
    const quoted = /^\s*>\s?/.exec(line);
    if (quoted) {
      quote = true;
      line = line.slice(quoted[0].length);
    }
    const lead = /^\s*/.exec(line)![0].length;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      out.push({
        runs: parseInline(heading[2]),
        scale: HEADING_SCALE[heading[1].length - 1],
        bold: true,
        indent: quote ? 1 : 0,
        marker: '',
        code: false,
        quote,
      });
      continue;
    }
    let marker = '';
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      indent = Math.floor(lead / 2);
      marker = BULLETS[Math.min(indent, BULLETS.length - 1)];
      line = bullet[1];
    } else if (ordered) {
      indent = Math.floor(lead / 2);
      marker = `${ordered[1]}.`;
      line = ordered[2];
    } else {
      line = line.trim();
    }
    out.push({
      runs: parseInline(line),
      scale: 1,
      bold: false,
      indent: indent + (quote ? 1 : 0),
      marker,
      code: false,
      quote,
    });
  }
  return out;
}

// -------------------------------------------------------------------- layout

function fontFor(style: TextStyle, block: MdBlock, run: MdRun): FontSpec {
  const size = style.size * block.scale;
  return {
    family: run.code || block.code ? style.monoFamily : style.family,
    size: run.code || block.code ? size * 0.92 : size,
    weight: run.bold || block.bold ? '700' : style.weight,
    style: run.italic ? 'italic' : style.style,
    letterSpacing: style.letterSpacing,
  };
}

function runAttrs(style: TextStyle, block: MdBlock, run: MdRun, font: FontSpec): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (font.family !== style.family) attrs['font-family'] = font.family;
  if (font.size !== style.size) attrs['font-size'] = `${round(font.size)}`;
  if (font.weight !== style.weight) attrs['font-weight'] = font.weight;
  if (font.style !== style.style) attrs['font-style'] = font.style;
  if (run.strike) attrs['text-decoration'] = 'line-through';
  // Markdown's own accents come from the canvas palette, so a label reads on any theme.
  if (run.code || block.code) attrs.fill = MD_CODE_COLOR;
  else if (block.quote) attrs.fill = MD_MUTED_COLOR;
  return attrs;
}

const MD_CODE_COLOR = 'var(--sw-5, #b4506b)';
const MD_MUTED_COLOR = 'var(--sw-ink-muted, #6b7280)';
const MD_RULE_COLOR = 'var(--sw-line, #c7ccd6)';

/**
 * Place every run of every line, with the block's top-left at (0, 0).
 *
 * `y` on a run is the baseline, which is where SVG wants it; the block's height runs from
 * the first line's ascent to the last line's descent, so the box matches the ink.
 */
export function layoutMarkdown(src: string, style: TextStyle): MdLayout {
  const blocks = parseMarkdown(src);
  const lines: LaidLine[] = [];
  let width = 0;
  let top = 0;
  blocks.forEach((block, index) => {
    const size = style.size * block.scale;
    if (block.runs.length === 0 || (block.runs.length === 1 && block.runs[0].text === '')) {
      // A blank line still advances, or two paragraphs would sit on top of each other.
      if (index > 0) top += size * BLANK_SPACING;
      return;
    }
    const base = fontFor(style, block, { text: '' });
    const metrics = measureVertical(base);
    const y = top + metrics.ascent;
    let x = block.indent * style.size * INDENT_EM;
    const runs: LaidRun[] = [];
    if (block.quote) {
      const bar = { text: QUOTE_BAR, x: x - style.size * 0.9, attrs: { fill: MD_RULE_COLOR } };
      runs.push(bar);
    }
    if (block.marker) {
      runs.push({ text: block.marker, x, attrs: { fill: MD_MUTED_COLOR } });
      x += Math.max(measureWidth(block.marker, base), style.size * 0.5) + style.size * 0.35;
    }
    for (const run of block.runs) {
      if (!run.text) continue;
      const font = fontFor(style, block, run);
      const advance = measureWidth(run.text, font);
      // SVG collapses whitespace at the edges of a span, so the space after `**bold**`
      // would vanish. The text is drawn trimmed, shifted by the space it swallowed, and
      // the cursor still advances by the full run — spacing survives either way.
      const drawn = run.text.trim();
      if (drawn) {
        const lead = run.text.length - run.text.trimStart().length;
        const shift = lead ? measureWidth(run.text.slice(0, lead), font) : 0;
        runs.push({ text: drawn, x: x + shift, attrs: runAttrs(style, block, run, font) });
      }
      x += advance;
    }
    lines.push({ y, runs });
    width = Math.max(width, x);
    top = y + metrics.descent + size * (LINE_SPACING - 1);
  });
  // Empty text still needs somewhere to click: without a box it could never be re-opened.
  if (lines.length === 0) return { width: style.size * 2, height: style.size * 1.2, lines };
  return { width, height: top, lines };
}

/**
 * The laid-out block as SVG children of a `<text>`, offset to the element's own anchor.
 *
 * The anchor is the block's top-left: a text element on a drawing is a box you position,
 * not a baseline you balance text on.
 */
export function markdownChildren(layout: MdLayout, origin: { x: number; y: number }): VNode[] {
  const out: VNode[] = [];
  for (const line of layout.lines) {
    for (const run of line.runs) {
      out.push({
        tag: 'tspan',
        attrs: { ...run.attrs, x: `${round(origin.x + run.x)}`, y: `${round(origin.y + line.y)}` },
        children: [],
        text: run.text,
      });
    }
  }
  return out;
}

/** The block's box in the element's own coordinates. */
export function markdownBounds(layout: MdLayout, origin: { x: number; y: number }): Rect {
  return rect(origin.x, origin.y, layout.width, layout.height);
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
