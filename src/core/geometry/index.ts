export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transform {
  x: number;
  y: number;
  rot: number;
  scale: number;
  /**
   * Local-space point that `rot` turns about. Resolved at graph time (the centre
   * of the instance box) and never persisted; absent means the local origin.
   */
  pivot?: Vec;
}

export const vec = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const eq = (a: Vec, b: Vec, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

export function norm(a: Vec): Vec {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const IDENTITY: Transform = { x: 0, y: 0, rot: 0, scale: 1 };

/** Local (component) space -> world space. */
export function toWorld(t: Transform, p: Vec): Vec {
  const scaled = { x: p.x * t.scale, y: p.y * t.scale };
  if (!t.rot) return { x: scaled.x + t.x, y: scaled.y + t.y };
  const px = (t.pivot?.x ?? 0) * t.scale;
  const py = (t.pivot?.y ?? 0) * t.scale;
  const r = rotate({ x: scaled.x - px, y: scaled.y - py }, t.rot);
  return { x: r.x + px + t.x, y: r.y + py + t.y };
}

/** World space -> local (component) space. */
export function toLocal(t: Transform, p: Vec): Vec {
  const s = t.scale === 0 ? 1 : t.scale;
  const moved = { x: p.x - t.x, y: p.y - t.y };
  if (!t.rot) return { x: moved.x / s, y: moved.y / s };
  const px = (t.pivot?.x ?? 0) * s;
  const py = (t.pivot?.y ?? 0) * s;
  const r = rotate({ x: moved.x - px, y: moved.y - py }, -t.rot);
  return { x: (r.x + px) / s, y: (r.y + py) / s };
}

export const rect = (x = 0, y = 0, w = 0, h = 0): Rect => ({ x, y, w, h });

export const rectCenter = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const rectRight = (r: Rect): number => r.x + r.w;
export const rectBottom = (r: Rect): number => r.y + r.h;

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectFromPoints(a: Vec, b: Vec): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function boundsOf(points: readonly Vec[]): Rect {
  if (points.length === 0) return rect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** World-space AABB of a local-space rect under a transform (handles rotation). */
export function transformedBounds(t: Transform, local: Rect): Rect {
  const corners: Vec[] = [
    { x: local.x, y: local.y },
    { x: local.x + local.w, y: local.y },
    { x: local.x + local.w, y: local.y + local.h },
    { x: local.x, y: local.y + local.h },
  ].map((p) => toWorld(t, p));
  return boundsOf(corners);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function snapTo(v: number, step: number, origin = 0): number {
  if (step <= 0) return v;
  return Math.round((v - origin) / step) * step + origin;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polylineLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  return total;
}

export function pointAtLength(points: readonly Vec[], at: number): Vec {
  if (points.length === 0) return vec();
  let remaining = at;
  for (let i = 1; i < points.length; i += 1) {
    const seg = dist(points[i - 1], points[i]);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg < 1e-9 ? 0 : clamp(remaining / seg, 0, 1);
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    remaining -= seg;
  }
  return points[points.length - 1];
}

const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0');

/** SVG path data from a polyline, with optional rounded corners. */
export function polylinePath(points: readonly Vec[], radius = 0): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${n(points[0].x)} ${n(points[0].y)}`;
  if (radius <= 0) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ');
  }
  const parts: string[] = [`M ${n(points[0].x)} ${n(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const rIn = Math.min(radius, dist(prev, cur) / 2);
    const rOut = Math.min(radius, dist(cur, next) / 2);
    const dIn = norm(sub(prev, cur));
    const dOut = norm(sub(next, cur));
    const a = { x: cur.x + dIn.x * rIn, y: cur.y + dIn.y * rIn };
    const b = { x: cur.x + dOut.x * rOut, y: cur.y + dOut.y * rOut };
    parts.push(`L ${n(a.x)} ${n(a.y)}`);
    parts.push(`Q ${n(cur.x)} ${n(cur.y)} ${n(b.x)} ${n(b.y)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${n(last.x)} ${n(last.y)}`);
  return parts.join(' ');
}

/** Smooth cubic path through the given points (Catmull-Rom converted to bezier). */
export function smoothPath(points: readonly Vec[], tension = 0.5): string {
  if (points.length < 3) return polylinePath(points);
  const parts: string[] = [`M ${n(points[0].x)} ${n(points[0].y)}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension * 2, y: p1.y + ((p2.y - p0.y) / 6) * tension * 2 };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension * 2, y: p2.y - ((p3.y - p1.y) / 6) * tension * 2 };
    parts.push(`C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`);
  }
  return parts.join(' ');
}
