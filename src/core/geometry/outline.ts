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

/**
 * The lattice a sliding attach point is pulled onto. `step` is the routing step, not the
 * drawn cell size, so an attach point lines up with the lanes the router works on.
 */
export interface AttachGrid {
  step: number;
  origin?: Vec;
}

/** How far, in grid steps, an attach point may be nudged to reach a grid line. */
const SNAP_REACH = 0.75;

/**
 * True when the outline encloses its own centre, so a ray leaving that centre always
 * finds an edge — and the point it finds can be anywhere on the shape, not just its
 * extremes. An open stroke is met where it runs instead.
 */
export function isClosedOutline(o: Outline): boolean {
  return o.kind === 'ellipse' || o.closed;
}

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
 *
 * With a `grid`, the point slides along the outline onto the nearest grid line: along the
 * straight run it landed on, or, on an ellipse, along the curve. A shape annotated as a
 * port is otherwise met at whatever spot the geometry works out to, and a connector
 * leaving it would start off-lattice and stay there.
 */
export function outlineAttach(o: Outline, toward: Vec, grid?: AttachGrid): { pos: Vec; facing: Vec } {
  const hit = attachPoint(o, toward);
  return grid ? snapAlong(o, hit, grid) : hit;
}

function attachPoint(o: Outline, toward: Vec): { pos: Vec; facing: Vec } {
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
 * Slide an attach point along the straight run it landed on until it sits on a grid line.
 *
 * Only the run carrying the point is considered, so the connector still meets the edge it
 * was aimed at, and the move is capped at `SNAP_REACH` steps: the nearest lattice line is
 * always within half a step along an axis-aligned run, and a diagonal one reaches a little
 * further. A flattened arc is left alone, because its segments are far shorter than a grid
 * step, so no lattice line falls inside the one it hit — a real ellipse is handled by the
 * curve of its own.
 */
function snapAlong(o: Outline, hit: { pos: Vec; facing: Vec }, grid: AttachGrid): { pos: Vec; facing: Vec } {
  const step = grid.step;
  if (!(step > 0)) return hit;
  if (o.kind === 'ellipse') return snapAlongEllipse(o, hit, grid);
  const run = runAt(o, hit.pos);
  if (!run) return hit;
  const [a, b] = run;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  if (Math.hypot(ex, ey) < EPS) return hit;

  const origin = grid.origin ?? { x: 0, y: 0 };
  const limit = step * SNAP_REACH;
  let best: Vec | null = null;
  let bestDist = Infinity;
  const consider = (u: number): void => {
    if (!Number.isFinite(u) || u < 0 || u > 1) return;
    const p = { x: a.x + ex * u, y: a.y + ey * u };
    const d = Math.hypot(p.x - hit.pos.x, p.y - hit.pos.y);
    if (d > limit || d >= bestDist) return;
    best = p;
    bestDist = d;
  };
  // A run that spans x can reach a vertical grid line, one that spans y a horizontal one.
  // An axis-aligned run offers only its own free axis; a diagonal offers both, nearest wins.
  if (Math.abs(ex) > EPS) {
    const k = (hit.pos.x - origin.x) / step;
    for (const g of [Math.floor(k), Math.ceil(k)]) consider((origin.x + g * step - a.x) / ex);
  }
  if (Math.abs(ey) > EPS) {
    const k = (hit.pos.y - origin.y) / step;
    for (const g of [Math.floor(k), Math.ceil(k)]) consider((origin.y + g * step - a.y) / ey);
  }
  return best ? { pos: best, facing: hit.facing } : hit;
}

/** A point on an ellipse at parameter `t`, with the outward normal there. */
function ellipsePoint(o: Extract<Outline, { kind: 'ellipse' }>, t: number): { pos: Vec; facing: Vec } {
  const rx = Math.max(o.rx, EPS);
  const ry = Math.max(o.ry, EPS);
  const p = { x: Math.cos(t) * rx, y: Math.sin(t) * ry };
  const n = norm({ x: p.x / (rx * rx), y: p.y / (ry * ry) });
  const world = rotate(p, o.rot);
  return { pos: { x: o.c.x + world.x, y: o.c.y + world.y }, facing: rotate(n, o.rot) };
}

/**
 * Slide an attach point along a curve until one of its coordinates sits on a grid line.
 *
 * A circle is the one port shape with no flat to slide along, and it is the common one —
 * the software symbols wrap each icon in a ring. Sampling it by direction lands wherever
 * the ray happens to cross, so a connector left at an angle no lattice line agrees with,
 * and the whole route inherited that offset.
 *
 * Which coordinate matters is decided by the way the port faces: one facing along x departs
 * horizontally and holds its y, so it is y that has to be on a lane. A diagonal facing holds
 * neither and takes whichever line is nearer. The move is capped at `SNAP_REACH` steps, as
 * on a straight run.
 *
 * A port that faces an axis also leaves along it. The surface normal at wherever the point
 * slid to is a few degrees off, and a stub that followed it would step straight back off the
 * lane the slide just put it on — which is the kink this is here to remove, moved along by
 * one segment. Only a diagonal facing keeps the true normal, having no axis to hold.
 *
 * Solved rather than searched: an offset from the centre is `a·cos t + b·sin t` on either
 * axis, which is `R·cos(t − φ)`, so the parameters that put a coordinate on a given line are
 * `φ ± acos((line − centre) / R)` — no solution when the line misses the ellipse entirely.
 */
function snapAlongEllipse(
  o: Extract<Outline, { kind: 'ellipse' }>,
  hit: { pos: Vec; facing: Vec },
  grid: AttachGrid,
): { pos: Vec; facing: Vec } {
  const step = grid.step;
  const origin = grid.origin ?? { x: 0, y: 0 };
  const limit = step * SNAP_REACH;
  const rx = Math.max(o.rx, EPS);
  const ry = Math.max(o.ry, EPS);
  const rad = (o.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const coef = {
    x: { a: rx * cos, b: -ry * sin, c: o.c.x },
    y: { a: rx * sin, b: ry * cos, c: o.c.y },
  };
  const fx = Math.abs(hit.facing.x);
  const fy = Math.abs(hit.facing.y);
  const axes: ('x' | 'y')[] = fx > fy + EPS ? ['y'] : fy > fx + EPS ? ['x'] : ['x', 'y'];
  // Holding y means departing along x, and vice versa; a diagonal has nothing to hold.
  const departure =
    axes.length === 1
      ? axes[0] === 'y'
        ? { x: Math.sign(hit.facing.x), y: 0 }
        : { x: 0, y: Math.sign(hit.facing.y) }
      : null;

  let best: { pos: Vec; facing: Vec } | null = null;
  let bestDist = Infinity;
  for (const axis of axes) {
    const { a, b, c } = coef[axis];
    const r = Math.hypot(a, b);
    if (r < EPS) continue;
    const phi = Math.atan2(b, a);
    const k = (hit.pos[axis] - origin[axis]) / step;
    for (const g of [Math.floor(k), Math.ceil(k)]) {
      const ratio = (origin[axis] + g * step - c) / r;
      if (Math.abs(ratio) > 1) continue;
      const spread = Math.acos(ratio);
      for (const t of [phi + spread, phi - spread]) {
        const p = ellipsePoint(o, t);
        const d = Math.hypot(p.pos.x - hit.pos.x, p.pos.y - hit.pos.y);
        if (d > limit || d >= bestDist) continue;
        best = { pos: p.pos, facing: departure ?? p.facing };
        bestDist = d;
      }
    }
  }
  return best ?? hit;
}

/** The straight run of the outline that `p` sits on. */
function runAt(o: { points: Vec[]; closed: boolean }, p: Vec): [Vec, Vec] | null {
  let best: [Vec, Vec] | null = null;
  let bestDist = Infinity;
  for (const seg of segments(o)) {
    const d = distToSegment(p, seg[0], seg[1]);
    if (d >= bestDist) continue;
    bestDist = d;
    best = seg;
  }
  return best;
}

/** Mean of the stroke's own points - a stand-in for which side of it is "inside". */function centroidOf(points: Vec[]): Vec {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * How clearly a normal has to lean away from the stroke's own body before it is trusted
 * over the side the connector arrives from. Both vectors are unit length, so this is the
 * cosine of the angle between them.
 */
const BULGE_EPS = 0.25;

/**
 * The point of an open stroke nearest `target`.
 *
 * A curved stroke - an arc cap, say - has a genuine outside: the side its own centroid is
 * not on. Leaving along that normal is the only exit that clears the shape, so it wins
 * wherever the curvature makes it unambiguous. That matters most at a tip approached from
 * the concave side, where facing the connector points straight back through the component
 * and the exit stub would have to cut across the body to reach open space.
 *
 * A straight stroke has no such side - its centroid lies on the line - so it keeps the old
 * rule: the normal towards the side the connector arrives from, or, at a free end where
 * there is no edge to be perpendicular to, back along the approach itself.
 */
function outlineProject(o: { points: Vec[]; closed: boolean }, target: Vec): { pos: Vec; facing: Vec } {
  const centroid = centroidOf(o.points);
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
    const outward = norm({ x: pos.x - centroid.x, y: pos.y - centroid.y });
    const bulge = n.x * outward.x + n.y * outward.y;
    const facing =
      Math.abs(bulge) >= BULGE_EPS
        ? { x: n.x * Math.sign(bulge), y: n.y * Math.sign(bulge) }
        : onEnd && Math.hypot(approach.x, approach.y) > EPS
          ? approach
          : perpendicular;
    best = { pos, facing, d };
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
