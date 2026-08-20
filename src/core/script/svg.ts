import type { Rect, Vec } from '../geometry/index';
import { boundsOf, rect } from '../geometry/index';
import { ellipseToPolygon, type Outline } from '../geometry/outline';

export interface VNode {
  tag: string;
  attrs: Record<string, string>;
  children: VNode[];
  text?: string;
}

export const SVG_TAGS = new Set([
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
  'defs',
  'marker',
  'symbol',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
  'desc',
  'foreignObject',
  'image',
  'svg',
]);

const ATTR_ALLOW = new Set([
  'id',
  'class',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'letter-spacing',
  'marker-end',
  'marker-start',
  'marker-mid',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'viewBox',
  'preserveAspectRatio',
  'clip-path',
  'vector-effect',
  'pointer-events',
  'visibility',
  'orient',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'paint-order',
  'shape-rendering',
]);

const DATA_PREFIX = 'data-swcad-';

export function isAllowedAttr(name: string): boolean {
  if (name.startsWith('on')) return false;
  if (name === 'href' || name === 'xlink:href') return false;
  return ATTR_ALLOW.has(name) || name.startsWith(DATA_PREFIX);
}

// ------------------------------------------------------------------ builders

export function el(
  tag: string,
  attrs: Record<string, string | number | undefined | null> = {},
  children: (VNode | null | undefined)[] = [],
): VNode {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    clean[key] = String(value);
  }
  return { tag, attrs: clean, children: children.filter(Boolean) as VNode[] };
}

export function textEl(
  content: string,
  attrs: Record<string, string | number | undefined | null> = {},
): VNode {
  const node = el('text', attrs);
  node.text = String(content);
  return node;
}

export const svgBuilder = Object.freeze({
  el,
  g: (attrs?: Record<string, string | number>, children?: (VNode | null)[]) => el('g', attrs, children ?? []),
  path: (attrs: Record<string, string | number>) => el('path', attrs),
  rect: (attrs: Record<string, string | number>) => el('rect', attrs),
  circle: (attrs: Record<string, string | number>) => el('circle', attrs),
  ellipse: (attrs: Record<string, string | number>) => el('ellipse', attrs),
  line: (attrs: Record<string, string | number>) => el('line', attrs),
  polyline: (attrs: Record<string, string | number>) => el('polyline', attrs),
  polygon: (attrs: Record<string, string | number>) => el('polygon', attrs),
  text: textEl,
});

// -------------------------------------------------------------------- parser

/** `inner` excludes the closing '>', so a self-closing tag ends with a bare slash. */
const VOID_CLOSE = /\/$/;

/**
 * Small tolerant XML parser. Deliberately dependency free and DOM free so the
 * same code path runs in the browser, in tests and during export.
 */
export function parseSvg(source: string): VNode[] {
  const roots: VNode[] = [];
  const stack: VNode[] = [];
  let i = 0;
  const src = source ?? '';

  const push = (node: VNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) {
      const raw = src.slice(i, lt).trim();
      if (raw) {
        const parent = stack[stack.length - 1];
        if (parent) parent.text = (parent.text ?? '') + decodeEntities(raw);
      }
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    if (gt === -1) break;
    const inner = src.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (inner.startsWith('/')) {
      stack.pop();
      continue;
    }
    const selfClosing = VOID_CLOSE.test(inner);
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const spaceAt = body.search(/\s/);
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).trim();
    const attrText = spaceAt === -1 ? '' : body.slice(spaceAt + 1);
    const node: VNode = { tag, attrs: parseAttrs(attrText), children: [] };
    push(node);
    if (!selfClosing) stack.push(node);
  }
  return roots;
}

function findTagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:A-Za-z_][-:.\w]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- sanitizing

/** Drop unknown tags and unsafe attributes from a (possibly script produced) tree. */
export function sanitize(nodes: VNode[]): VNode[] {
  const out: VNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node.tag !== 'string') continue;
    if (!SVG_TAGS.has(node.tag)) continue;
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      if (!isAllowedAttr(key)) continue;
      const str = String(value);
      if (/^\s*(javascript|data):/i.test(str)) continue;
      attrs[key] = str;
    }
    out.push({
      tag: node.tag,
      attrs,
      children: sanitize(node.children ?? []),
      ...(node.text !== undefined ? { text: String(node.text) } : {}),
    });
  }
  return out;
}

export function serialize(nodes: VNode[]): string {
  return nodes
    .map((node) => {
      const attrs = Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
        .join('');
      const inner = `${node.text ? escapeXml(node.text) : ''}${serialize(node.children)}`;
      return inner ? `<${node.tag}${attrs}>${inner}</${node.tag}>` : `<${node.tag}${attrs} />`;
    })
    .join('');
}

export function findById(nodes: VNode[], id: string): VNode | null {
  for (const node of nodes) {
    if (node.attrs.id === id) return node;
    const hit = findById(node.children, id);
    if (hit) return hit;
  }
  return null;
}

export function walk(nodes: VNode[], visit: (node: VNode, parent: VNode | null) => void, parent: VNode | null = null): void {
  for (const node of nodes) {
    visit(node, parent);
    walk(node.children, visit, node);
  }
}

// ----------------------------------------------------------------- geometry

const num = (v: string | undefined, fallback = 0): number => {
  const parsed = Number.parseFloat(v ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parsePoints(value: string | undefined): Vec[] {
  if (!value) return [];
  const parts = value.trim().split(/[\s,]+/).map(Number);
  const out: Vec[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ x: parts[i], y: parts[i + 1] });
  return out;
}

/** Argument counts per path command letter (uppercased). */
const PATH_ARG_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

interface PathCommand {
  /** Command letter, case preserved (lowercase = relative). */
  cmd: string;
  args: number[];
}

/**
 * Splits path data into commands, expanding repeated argument sets (`L 1 2 3 4`) and the
 * implicit lineto that follows a moveto (`M 1 2 3 4` = `M 1 2 L 3 4`).
 *
 * Scanned character by character rather than tokenised with one number pattern, because an
 * arc's two flags are single digits that need no separator: `a1 1 0 011 1` is seven
 * arguments, not five. Optimisers emit that form routinely, and reading `011` as one number
 * throws the rest of the path out.
 */
function parsePathCommands(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  const n = d.length;
  let cmd = '';
  let i = 0;

  const skipSep = (): void => {
    while (i < n && (d[i] === ' ' || d[i] === ',' || d[i] === '\t' || d[i] === '\n' || d[i] === '\r')) i += 1;
  };

  const readNumber = (): number | null => {
    skipSep();
    const start = i;
    if (i < n && (d[i] === '+' || d[i] === '-')) i += 1;
    while (i < n && d[i] >= '0' && d[i] <= '9') i += 1;
    if (i < n && d[i] === '.') {
      i += 1;
      while (i < n && d[i] >= '0' && d[i] <= '9') i += 1;
    }
    if (i < n && (d[i] === 'e' || d[i] === 'E')) {
      const mark = i;
      i += 1;
      if (i < n && (d[i] === '+' || d[i] === '-')) i += 1;
      if (i < n && d[i] >= '0' && d[i] <= '9') while (i < n && d[i] >= '0' && d[i] <= '9') i += 1;
      else i = mark;
    }
    if (i === start) return null;
    const value = Number(d.slice(start, i));
    return Number.isFinite(value) ? value : null;
  };

  const readFlag = (): number | null => {
    skipSep();
    if (i < n && (d[i] === '0' || d[i] === '1')) {
      const value = d[i] === '1' ? 1 : 0;
      i += 1;
      return value;
    }
    return null;
  };

  while (i < n) {
    skipSep();
    if (i >= n) break;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(d[i])) {
      cmd = d[i];
      i += 1;
      if (cmd === 'Z' || cmd === 'z') out.push({ cmd, args: [] });
      continue;
    }
    if (!cmd) return out;
    const count = PATH_ARG_COUNTS[cmd.toUpperCase()];
    if (!count) return out;
    const arc = cmd === 'A' || cmd === 'a';
    const args: number[] = [];
    for (let k = 0; k < count; k += 1) {
      const value = arc && (k === 3 || k === 4) ? readFlag() : readNumber();
      if (value === null) return out;
      args.push(value);
    }
    out.push({ cmd, args });
    // A repeated moveto argument set is a lineto.
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  return out;
}

/** Points sampled along curves and arcs, so bounds stay tight without a flattening library. */
const CURVE_STEPS = 16;
const ARC_STEP = Math.PI / 12;

function sampleCubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, out: Vec[]): void {
  for (let i = 1; i <= CURVE_STEPS; i += 1) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

function sampleQuad(p0: Vec, p1: Vec, p2: Vec, out: Vec[]): void {
  for (let i = 1; i <= CURVE_STEPS; i += 1) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
}

/**
 * Centre parameterisation of an endpoint-parameterised elliptical arc
 * (SVG spec F.6.5). `theta` is the start angle and `delta` the swept angle, both in
 * radians in the ellipse's own parameter space. Returns null for a degenerate arc.
 */
export function arcCenter(
  p0: Vec,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec,
): { cx: number; cy: number; rx: number; ry: number; theta: number; delta: number } | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return null;
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const denom = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const numer = rx * rx * ry * ry - denom;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numer / denom));
  const cxp = (coef * rx * y1) / ry;
  const cyp = (-coef * ry * x1) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  const theta = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
  const thetaEnd = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx);
  let delta = thetaEnd - theta;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, theta, delta };
}

/** Endpoint-parameterised elliptical arc, sampled (SVG spec F.6.5 centre conversion). */
function sampleArc(
  p0: Vec,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec,
  out: Vec[],
): void {
  const arc = arcCenter(p0, rxIn, ryIn, rotationDeg, largeArc, sweep, p1);
  if (!arc) {
    out.push(p1);
    return;
  }
  const { cx, cy, rx, ry, theta, delta } = arc;
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / ARC_STEP));
  for (let i = 1; i <= steps; i += 1) {
    const t = theta + (delta * i) / steps;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    out.push({
      x: cx + rx * ct * cosPhi - ry * st * sinPhi,
      y: cy + rx * ct * sinPhi + ry * st * cosPhi,
    });
  }
}

/**
 * Points along a path: command stream walked properly (relative commands, H/V, implicit
 * repeats) with Beziers and elliptical arcs flattened, so bounds and outlines follow the
 * drawn shape rather than the raw numbers in the `d` string.
 */
export function pathPoints(d: string | undefined): Vec[] {
  if (!d) return [];
  const out: Vec[] = [];
  let cur: Vec = { x: 0, y: 0 };
  let start: Vec = { x: 0, y: 0 };
  let lastCubicCtrl: Vec | null = null;
  let lastQuadCtrl: Vec | null = null;

  for (const { cmd, args } of parsePathCommands(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const px = rel ? cur.x : 0;
    const py = rel ? cur.y : 0;
    const pt = (x: number, y: number): Vec => ({ x: px + x, y: py + y });

    switch (upper) {
      case 'M': {
        cur = pt(args[0], args[1]);
        start = cur;
        out.push(cur);
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'L': {
        cur = pt(args[0], args[1]);
        out.push(cur);
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'H': {
        cur = { x: px + args[0], y: cur.y };
        out.push(cur);
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'V': {
        cur = { x: cur.x, y: py + args[0] };
        out.push(cur);
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'C': {
        const c1 = pt(args[0], args[1]);
        const c2 = pt(args[2], args[3]);
        const end = pt(args[4], args[5]);
        sampleCubic(cur, c1, c2, end, out);
        cur = end;
        lastCubicCtrl = c2;
        lastQuadCtrl = null;
        break;
      }
      case 'S': {
        const c1 = lastCubicCtrl ? { x: 2 * cur.x - lastCubicCtrl.x, y: 2 * cur.y - lastCubicCtrl.y } : cur;
        const c2 = pt(args[0], args[1]);
        const end = pt(args[2], args[3]);
        sampleCubic(cur, c1, c2, end, out);
        cur = end;
        lastCubicCtrl = c2;
        lastQuadCtrl = null;
        break;
      }
      case 'Q': {
        const c = pt(args[0], args[1]);
        const end = pt(args[2], args[3]);
        sampleQuad(cur, c, end, out);
        cur = end;
        lastQuadCtrl = c;
        lastCubicCtrl = null;
        break;
      }
      case 'T': {
        const c: Vec = lastQuadCtrl ? { x: 2 * cur.x - lastQuadCtrl.x, y: 2 * cur.y - lastQuadCtrl.y } : cur;
        const end = pt(args[0], args[1]);
        sampleQuad(cur, c, end, out);
        cur = end;
        lastQuadCtrl = c;
        lastCubicCtrl = null;
        break;
      }
      case 'A': {
        const end = pt(args[5], args[6]);
        sampleArc(cur, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, end, out);
        cur = end;
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      case 'Z': {
        cur = start;
        out.push(cur);
        lastCubicCtrl = null;
        lastQuadCtrl = null;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Affine matrix `[a b c d e f]` for an element's own `transform` attribute, or
 * `null` when it is absent or uses a function we do not model.
 */
function transformMatrix(value: string | undefined): [number, number, number, number, number, number] | null {
  if (!value || value.trim() === '') return null;
  const fns = value.match(/[a-zA-Z]+\([^)]*\)/g);
  if (!fns) return null;
  let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  const mul = (
    x: [number, number, number, number, number, number],
    y: [number, number, number, number, number, number],
  ): [number, number, number, number, number, number] => [
    x[0] * y[0] + x[2] * y[1],
    x[1] * y[0] + x[3] * y[1],
    x[0] * y[2] + x[2] * y[3],
    x[1] * y[2] + x[3] * y[3],
    x[0] * y[4] + x[2] * y[5] + x[4],
    x[1] * y[4] + x[3] * y[5] + x[5],
  ];
  for (const fn of fns) {
    const name = fn.slice(0, fn.indexOf('(')).trim();
    const args = fn.slice(fn.indexOf('(') + 1, -1).trim();
    const a = args === '' ? [] : args.split(/[\s,]+/).map(Number);
    if (a.some((v) => !Number.isFinite(v))) return null;
    if (name === 'translate') m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (name === 'scale') m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (name === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const cx = a[1] ?? 0;
      const cy = a[2] ?? 0;
      m = mul(m, [1, 0, 0, 1, cx, cy]);
      m = mul(m, [c, s, -s, c, 0, 0]);
      m = mul(m, [1, 0, 0, 1, -cx, -cy]);
    } else if (name === 'matrix' && a.length === 6) {
      m = mul(m, [a[0], a[1], a[2], a[3], a[4], a[5]]);
    } else return null;
  }
  return m;
}

const applyMatrix = (m: [number, number, number, number, number, number], p: Vec): Vec => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

/** Local-space bounds of an element (approximate for curves), including its own `transform`. */
export function elementBounds(node: VNode): Rect {
  const box = untransformedBounds(node);
  const m = transformMatrix(node.attrs.transform);
  if (!m) return box;
  return boundsOf([
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ].map((p) => applyMatrix(m, p)));
}

function untransformedBounds(node: VNode): Rect {
  switch (node.tag) {
    case 'rect':
      return rect(num(node.attrs.x), num(node.attrs.y), num(node.attrs.width), num(node.attrs.height));
    case 'circle': {
      const r = num(node.attrs.r);
      return rect(num(node.attrs.cx) - r, num(node.attrs.cy) - r, r * 2, r * 2);
    }
    case 'ellipse': {
      const rx = num(node.attrs.rx);
      const ry = num(node.attrs.ry);
      return rect(num(node.attrs.cx) - rx, num(node.attrs.cy) - ry, rx * 2, ry * 2);
    }
    case 'line':
      return boundsOf([
        { x: num(node.attrs.x1), y: num(node.attrs.y1) },
        { x: num(node.attrs.x2), y: num(node.attrs.y2) },
      ]);
    case 'polyline':
    case 'polygon':
      return boundsOf(parsePoints(node.attrs.points));
    case 'path':
      return boundsOf(pathPoints(node.attrs.d));
    case 'text':
      return rect(num(node.attrs.x), num(node.attrs.y) - num(node.attrs['font-size'], 12), 0, 0);
    default: {
      const child = node.children.map(elementBounds).filter((b) => b.w > 0 || b.h > 0);
      if (child.length === 0) return rect();
      let out = child[0];
      for (const b of child.slice(1)) {
        const x = Math.min(out.x, b.x);
        const y = Math.min(out.y, b.y);
        out = { x, y, w: Math.max(out.x + out.w, b.x + b.w) - x, h: Math.max(out.y + out.h, b.y + b.h) - y };
      }
      return out;
    }
  }
}

/**
 * The element's drawn edge in local space, so a whole shape can act as a port.
 * Curves are approximated by their control points; `null` for elements with no
 * meaningful outline (text, empty groups).
 */
export function elementOutline(node: VNode): Outline | null {
  const m = transformMatrix(node.attrs.transform);
  const at = (p: Vec): Vec => (m ? applyMatrix(m, p) : p);
  const poly = (points: Vec[], closed: boolean): Outline | null =>
    points.length < 2 ? null : { kind: 'polygon', points: points.map(at), closed };

  switch (node.tag) {
    case 'rect': {
      const x = num(node.attrs.x);
      const y = num(node.attrs.y);
      const w = num(node.attrs.width);
      const h = num(node.attrs.height);
      if (w <= 0 || h <= 0) return null;
      return poly([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
    }
    case 'circle':
    case 'ellipse': {
      const rx = node.tag === 'circle' ? num(node.attrs.r) : num(node.attrs.rx);
      const ry = node.tag === 'circle' ? num(node.attrs.r) : num(node.attrs.ry);
      if (rx <= 0 || ry <= 0) return null;
      const c = { x: num(node.attrs.cx), y: num(node.attrs.cy) };
      // A transform can rotate or shear the ellipse; sampling keeps that honest.
      if (!m) return { kind: 'ellipse', c, rx, ry, rot: 0 };
      const sampled = ellipseToPolygon({ kind: 'ellipse', c, rx, ry, rot: 0 }, 64);
      return sampled.kind === 'polygon' ? { kind: 'polygon', points: sampled.points.map(at), closed: true } : null;
    }
    case 'line':
      return poly(
        [
          { x: num(node.attrs.x1), y: num(node.attrs.y1) },
          { x: num(node.attrs.x2), y: num(node.attrs.y2) },
        ],
        false,
      );
    case 'polyline':
      return poly(parsePoints(node.attrs.points), false);
    case 'polygon':
      return poly(parsePoints(node.attrs.points), true);
    case 'path': {
      const d = node.attrs.d ?? '';
      return poly(pathPoints(d), /z\s*$/i.test(d.trim()));
    }
    default: {
      const child = node.children.map(elementOutline).find(Boolean);
      return child ?? null;
    }
  }
}

/** Local-space anchor point of an element: the natural place a connector lands. */
export function elementPoint(node: VNode): Vec {  const p = untransformedPoint(node);
  const m = transformMatrix(node.attrs.transform);
  return m ? applyMatrix(m, p) : p;
}

function untransformedPoint(node: VNode): Vec {
  switch (node.tag) {
    case 'circle':
      return { x: num(node.attrs.cx), y: num(node.attrs.cy) };
    case 'ellipse':
      return { x: num(node.attrs.cx), y: num(node.attrs.cy) };
    case 'line':
      return {
        x: (num(node.attrs.x1) + num(node.attrs.x2)) / 2,
        y: (num(node.attrs.y1) + num(node.attrs.y2)) / 2,
      };
    case 'text':
      return { x: num(node.attrs.x), y: num(node.attrs.y) };
    default: {
      const b = untransformedBounds(node);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
  }
}

// --------------------------------------------------------------- geometry scaling

const ROUND_FACTOR = 1e4;

/** Rounds to ~4 decimal places and trims float noise (`0.30000000000000004` -> `0.3`). */
function formatNum(v: number): string {
  const rounded = Math.round(v * ROUND_FACTOR) / ROUND_FACTOR;
  return String(rounded === 0 ? 0 : rounded);
}

function parseFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function scaleSingle(value: string, factor: number): string {
  const n = parseFiniteNumber(value);
  return n === null ? value : formatNum(n * factor);
}

/** Axis each positional attribute moves along; anything absent here is left untouched. */
const AXIS_ATTRS: Record<string, 'x' | 'y'> = {
  x: 'x',
  cx: 'x',
  x1: 'x',
  x2: 'x',
  rx: 'x',
  y: 'y',
  cy: 'y',
  y1: 'y',
  y2: 'y',
  ry: 'y',
  width: 'x',
  height: 'y',
  dx: 'x',
  dy: 'y',
};

const POINTS_SPLIT_RE = /[\s,]+/;

function scalePoints(value: string, sx: number, sy: number): string {
  const trimmed = value.trim();
  if (trimmed === '') return value;
  const tokens = trimmed.split(POINTS_SPLIT_RE);
  if (tokens.length % 2 !== 0) return value;
  const nums = tokens.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return value;
  const out: string[] = [];
  for (let i = 0; i < nums.length; i += 2) out.push(`${formatNum(nums[i] * sx)},${formatNum(nums[i + 1] * sy)}`);
  return out.join(' ');
}

const NUMBER_SRC = '[+-]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][+-]?\\d+)?';
const TRANSFORM_FN_RE = new RegExp(`([a-zA-Z]+)\\(([^)]*)\\)`, 'g');
const TRANSFORM_SEQ_RE = new RegExp(`^\\s*(?:[a-zA-Z]+\\([^)]*\\)\\s*,?\\s*)+$`);

/**
 * `translate(a [b])` is a pure coordinate shift and a `rotate(a cx cy)` pivot is a
 * coordinate too, so both follow a resize. Any other transform function - and any
 * value we cannot parse cleanly - is left byte-for-byte alone.
 */
function scaleTransform(value: string, sx: number, sy: number): string {
  if (!TRANSFORM_SEQ_RE.test(value)) return value;
  let failed = false;
  TRANSFORM_FN_RE.lastIndex = 0;
  const out = value.replace(TRANSFORM_FN_RE, (whole, name: string, args: string) => {
    const nums = args.trim().length === 0 ? [] : args.trim().split(/[\s,]+/).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      failed = true;
      return whole;
    }
    if (name === 'translate' && (nums.length === 1 || nums.length === 2)) {
      const b = nums.length === 2 ? nums[1] : 0;
      return `translate(${formatNum(nums[0] * sx)} ${formatNum(b * sy)})`;
    }
    if (name === 'rotate' && nums.length === 3) {
      return `rotate(${formatNum(nums[0])} ${formatNum(nums[1] * sx)} ${formatNum(nums[2] * sy)})`;
    }
    return whole;
  });
  return failed ? value : out;
}

/** Argument kinds per path command letter (uppercased); 'x'/'y' scale, '-' passes through unchanged. */
const PATH_ARG_KINDS: Record<string, ('x' | 'y' | '-')[]> = {
  M: ['x', 'y'],
  L: ['x', 'y'],
  T: ['x', 'y'],
  H: ['x'],
  V: ['y'],
  C: ['x', 'y', 'x', 'y', 'x', 'y'],
  S: ['x', 'y', 'x', 'y'],
  Q: ['x', 'y', 'x', 'y'],
  A: ['x', 'y', '-', '-', '-', 'x', 'y'],
  Z: [],
};

const PATH_TOKEN_RE = new RegExp(`[MmLlHhVvCcSsQqTtAaZz]|${NUMBER_SRC}`, 'g');
const NON_SEPARATOR_RE = /[^\s,]/;

/** Scales the coordinates of an SVG path-data string. */
export function scalePathData(d: string, sx: number, sy: number): string {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return d;
  if (sx === 1 && sy === 1) return d;

  const tokens: string[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(d)) !== null) {
    if (match[0] === '') {
      // The number alternative always requires at least one digit, so this shouldn't happen;
      // guard anyway to avoid an infinite loop on unexpected input.
      PATH_TOKEN_RE.lastIndex += 1;
      continue;
    }
    if (NON_SEPARATOR_RE.test(d.slice(lastEnd, match.index))) return d;
    tokens.push(match[0]);
    lastEnd = PATH_TOKEN_RE.lastIndex;
  }
  if (NON_SEPARATOR_RE.test(d.slice(lastEnd))) return d;

  let out = '';
  let currentCmd = '';
  let pattern: ('x' | 'y' | '-')[] | undefined;
  let argIndex = 0;

  for (const token of tokens) {
    if (token.length === 1 && /[A-Za-z]/.test(token)) {
      currentCmd = token;
      pattern = PATH_ARG_KINDS[token.toUpperCase()];
      if (!pattern) return d;
      out += token;
      argIndex = 0;
      continue;
    }
    if (!currentCmd || !pattern || pattern.length === 0) return d;
    const value = Number(token);
    if (!Number.isFinite(value)) return d;
    const kind = pattern[argIndex % pattern.length];
    const scaled = kind === 'x' ? value * sx : kind === 'y' ? value * sy : value;
    out += `${argIndex === 0 ? '' : ' '}${formatNum(scaled)}`;
    argIndex += 1;
  }
  return out;
}

function scaleAttr(key: string, value: string, sx: number, sy: number): string {
  if (key === 'r') return scaleSingle(value, Math.min(sx, sy));
  if (key === 'points') return scalePoints(value, sx, sy);
  if (key === 'd') return scalePathData(value, sx, sy);
  if (key === 'transform') return scaleTransform(value, sx, sy);
  const axis = AXIS_ATTRS[key];
  if (axis === 'x') return scaleSingle(value, sx);
  if (axis === 'y') return scaleSingle(value, sy);
  return value;
}

function scaleNode(node: VNode, sx: number, sy: number): VNode {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attrs)) attrs[key] = scaleAttr(key, value, sx, sy);
  return {
    tag: node.tag,
    attrs,
    children: node.children.map((child) => scaleNode(child, sx, sy)),
    ...(node.text !== undefined ? { text: node.text } : {}),
  };
}

/** Returns a copy of the tree with positional geometry scaled by (sx, sy); presentation attributes are untouched. */
export function scaleGeometry(nodes: VNode[], sx: number, sy: number): VNode[] {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return nodes;
  if (sx === 1 && sy === 1) return nodes;
  return nodes.map((node) => scaleNode(node, sx, sy));
}

export function treeBounds(nodes: VNode[]): Rect {
  const boxes = nodes.map(elementBounds).filter((b) => Number.isFinite(b.x));
  if (boxes.length === 0) return rect();
  let out = boxes[0];
  for (const b of boxes.slice(1)) {
    const x = Math.min(out.x, b.x);
    const y = Math.min(out.y, b.y);
    out = { x, y, w: Math.max(out.x + out.w, b.x + b.w) - x, h: Math.max(out.y + out.h, b.y + b.h) - y };
  }
  return out;
}

/** One drawn primitive of a component and the box it occupies, in the tree's own space. */
export interface ElementPart {
  /** The element's `id`, or an empty string when it has none. */
  id: string;
  bounds: Rect;
}

/**
 * Every drawn primitive in the tree with a box of its own, rather than one box around the
 * lot. A component made of separate strokes is mostly empty space, and a router handed a
 * single bounding box either cannot get out of it or cuts straight through its siblings.
 *
 * A group is descended into so its children are reported individually, unless it carries a
 * transform — then its children's boxes are in the group's own space, and the group is
 * reported whole rather than reporting boxes in the wrong place. An `svg` root counts as a
 * group. Elements with no area at all (text, empty groups) are left out: they are not
 * obstacles.
 *
 * Each box is grown by half the stroke it is drawn with, which is the difference between
 * the geometry and the ink. It matters most for a line: its geometric box is flat on one
 * axis, and a rectangle with no interior cannot block anything — a drawn line would be an
 * obstacle nothing ever collided with.
 */
export function elementParts(nodes: VNode[]): ElementPart[] {
  const out: ElementPart[] = [];
  const visit = (node: VNode): void => {
    if ((node.tag === 'g' || node.tag === 'svg') && !node.attrs.transform) {
      for (const child of node.children) visit(child);
      return;
    }
    const box = elementBounds(node);
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
    if (box.w <= 0 && box.h <= 0) return;
    const halo = strokeHalo(node);
    out.push({
      id: node.attrs.id ?? '',
      bounds: halo > 0 ? rect(box.x - halo, box.y - halo, box.w + halo * 2, box.h + halo * 2) : box,
    });
  };
  for (const node of nodes) visit(node);
  return out;
}

/** How far the ink reaches past the geometry: half the stroke, or nothing if unstroked. */
function strokeHalo(node: VNode): number {
  const stroke = node.attrs.stroke;
  if (!stroke || stroke === 'none' || stroke === 'transparent') return 0;
  return num(node.attrs['stroke-width'], 1) / 2;
}

