import type { Rect, Vec } from './index';
import { boundsOf, distToSegment, norm, rotate } from './index';

/**
 * The connectable surface of a port. A `point` port is a single spot; an
 * `outline` port is a whole edge - a circle's circumference, a rectangle's
 * stroke - and a connector lands wherever it meets that edge.
 */
export type Outline =
  | { kind: 'ellipse'; c: Vec; rx: number; ry: number; rot: number }
  | { kind: 'polygon'; points: Vec[]; closed: boolean };

const EPS = 1e-9;

export function outlineCenter(o: Outline): Vec {
  if (o.kind === 'ellipse') return { ...o.c };
  const b = boundsOf(o.points);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function outlineBounds(o: Outline): Rect {
  if (o.kind !== 'ellipse') return boundsOf(o.points);
  // Exact AABB of a rotated ellipse.
  const r = (o.rot * Math.PI) / 180;
  const dx = Math.hypot(o.rx * Math.cos(r), o.ry * Math.sin(r));
  const dy = Math.hypot(o.rx * Math.sin(r), o.ry * Math.cos(r));
  return { x: o.c.x - dx, y: o.c.y - dy, w: dx * 2, h: dy * 2 };
}

function segments(o: { points: Vec[]; closed: boolean }): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (let i = 1; i < o.points.length; i += 1) out.push([o.points[i - 1], o.points[i]]);
  if (o.closed && o.points.length > 2) out.push([o.points[o.points.length - 1], o.points[0]]);
  return out;
}

/**
 * Where a connector meets the outline when it comes from `toward`: for a shape that
 * encloses its centre, the crossing of the ray leaving that centre; for an open stroke,
 * the point on the stroke nearest the incoming end. Falls back to the centre only when
 * the direction is degenerate.
 */
export function outlineAttach(o: Outline, toward: Vec): { pos: Vec; facing: Vec } {
  const c = outlineCenter(o);
  const dir = { x: toward.x - c.x, y: toward.y - c.y };
  if (Math.hypot(dir.x, dir.y) < EPS) return { pos: c, facing: { x: 0, y: 0 } };

  if (o.kind === 'ellipse') {
    const local = rotate(dir, -o.rot);
    const rx = Math.max(o.rx, EPS);
    const ry = Math.max(o.ry, EPS);
    const t = 1 / Math.hypot(local.x / rx, local.y / ry);
    const p = { x: local.x * t, y: local.y * t };
    const n = norm({ x: p.x / (rx * rx), y: p.y / (ry * ry) });
    const world = rotate(p, o.rot);
    return { pos: { x: c.x + world.x, y: c.y + world.y }, facing: rotate(n, o.rot) };
  }

  // An open stroke - an arc, a line, a polyline - does not surround its own bounding-box
  // centre, so a ray leaving that centre can miss the stroke completely: a half-arc bulges
  // to one side, and once it is rotated it can be missed from every direction, leaving the
  // connector stranded at the centre. Meet the stroke where it actually runs instead.
  if (!o.closed) return outlineProject(o, toward);

  const d = norm(dir);
  let best: { pos: Vec; facing: Vec; t: number } | null = null;
  for (const [a, b] of segments(o)) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den;
    if (t < 0 || u < 0 || u > 1) continue;
    // Concave shapes can be crossed several times; the outermost hit is the edge.
    if (best && t <= best.t) continue;
    const outward = norm({ x: ey, y: -ex });
    const sign = outward.x * d.x + outward.y * d.y >= 0 ? 1 : -1;
    best = { pos: { x: c.x + d.x * t, y: c.y + d.y * t }, facing: { x: outward.x * sign, y: outward.y * sign }, t };
  }
  // A concave outline can hide its own centre, and then the ray escapes without a crossing.
  return best ? { pos: best.pos, facing: best.facing } : outlineProject(o, toward);
}

/**
 * The point of an open stroke nearest `target`, with the edge normal facing the side the
 * connector arrives from. At a free end there is no edge to be perpendicular to, so the
 * connector is faced back along its own approach.
 */
function outlineProject(o: { points: Vec[]; closed: boolean }, target: Vec): { pos: Vec; facing: Vec } {
  let best: { pos: Vec; facing: Vec; d: number } | null = null;
  for (const [a, b] of segments(o)) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < EPS) continue;
    const u = Math.min(1, Math.max(0, ((target.x - a.x) * ex + (target.y - a.y) * ey) / len2));
    const pos = { x: a.x + ex * u, y: a.y + ey * u };
    const d = Math.hypot(target.x - pos.x, target.y - pos.y);
    if (best && d >= best.d) continue;
    const away = { x: target.x - pos.x, y: target.y - pos.y };
    const n = norm({ x: ey, y: -ex });
    const sign = n.x * away.x + n.y * away.y >= 0 ? 1 : -1;
    const perpendicular = { x: n.x * sign, y: n.y * sign };
    const onEnd = u <= EPS || u >= 1 - EPS;
    const approach = norm(away);
    best = { pos, facing: onEnd && Math.hypot(approach.x, approach.y) > EPS ? approach : perpendicular, d };
  }
  if (best) return { pos: best.pos, facing: best.facing };
  const c = o.points.length > 0 ? outlineCenter({ kind: 'polygon', points: o.points, closed: o.closed }) : { x: 0, y: 0 };
  return { pos: c, facing: { x: 0, y: 0 } };
}

/** Distance from a point to the outline itself (not to the area it encloses). */
export function outlineDistance(o: Outline, p: Vec): number {
  if (o.kind === 'ellipse') {
    if (Math.abs(o.rx - o.ry) < 1e-6) return Math.abs(Math.hypot(p.x - o.c.x, p.y - o.c.y) - o.rx);
    return outlineDistance(ellipseToPolygon(o, 64), p);
  }
  let best = Infinity;
  for (const [a, b] of segments(o)) best = Math.min(best, distToSegment(p, a, b));
  return best === Infinity ? Infinity : best;
}

export function ellipseToPolygon(o: Extract<Outline, { kind: 'ellipse' }>, steps = 48): Outline {
  const points: Vec[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const p = rotate({ x: Math.cos(a) * o.rx, y: Math.sin(a) * o.ry }, o.rot);
    points.push({ x: o.c.x + p.x, y: o.c.y + p.y });
  }
  return { kind: 'polygon', points, closed: true };
}

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

/** SVG path data tracing the outline, used to highlight a connectable edge. */
export function outlinePath(o: Outline): string {
  if (o.kind === 'ellipse') {
    const left = rotate({ x: -o.rx, y: 0 }, o.rot);
    const right = rotate({ x: o.rx, y: 0 }, o.rot);
    const a = { x: o.c.x + left.x, y: o.c.y + left.y };
    const b = { x: o.c.x + right.x, y: o.c.y + right.y };
    const arc = `A ${n(o.rx)} ${n(o.ry)} ${n(o.rot)} 0 1`;
    return `M ${n(a.x)} ${n(a.y)} ${arc} ${n(b.x)} ${n(b.y)} ${arc} ${n(a.x)} ${n(a.y)} Z`;
  }
  if (o.points.length === 0) return '';
  const body = o.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ');
  return o.closed ? `${body} Z` : body;
}
