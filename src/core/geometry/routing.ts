import type { Rect, Vec } from './index';
import { clamp, dist, inflate, rectContains, rectFromPoints, rectIntersects, rectUnion } from './index';
import type { AStarTerminal } from './astar';
import { axisOf, routeAStar } from './astar';

export type RouteStyle = 'straight' | 'orthogonal' | 'curve';

export interface RouteEndpoint {
  pos: Vec;
  /** Outward normal. Zero vector means "no preference". */
  facing?: Vec;
}

export interface RouteOptions {
  style?: RouteStyle;
  /** How far the route leaves a port before turning. */
  stub?: number;
  obstacles?: Rect[];
  /** Extra clearance around obstacles. */
  clearance?: number;
  waypoints?: Vec[];
  /**
   * Bounds of the node each endpoint is attached to (absent for free endpoints). Used to
   * lengthen the exit stub past the node and to exempt that stub segment from colliding
   * with the node it legitimately starts/ends on.
   */
  fromOwnerBounds?: Rect;
  toOwnerBounds?: Rect;
  /**
   * `auto` (default) searches the routing lattice with A* and only falls back to the
   * legacy candidate-shape search when no path exists; `simple` forces the legacy search.
   */
  router?: 'auto' | 'simple';
  /** Cost of a corner for the A* router, in world units. Higher means straighter routes. */
  bendPenalty?: number;
  /**
   * Document grid step. When set, the router first searches a lattice made of the grid
   * lines themselves, so connectors run along the drawn grid; it falls back to the
   * obstacle-derived lattice when no grid-aligned route exists.
   */
  grid?: number;
  /** Origin the grid lines are measured from (defaults to 0,0). */
  gridOrigin?: Vec;
}

const isZero = (v?: Vec): boolean => !v || (Math.abs(v.x) < 1e-6 && Math.abs(v.y) < 1e-6);

/** Distance from `origin` (assumed inside `r`) to the nearest edge of `r` along `dir`. */
function exitDistance(origin: Vec, dir: Vec, r: Rect): number {
  if (isZero(dir) || !rectContains(r, origin)) return 0;
  const l = Math.hypot(dir.x, dir.y) || 1;
  const dx = dir.x / l;
  const dy = dir.y / l;
  let t = Infinity;
  if (Math.abs(dx) > 1e-9) t = Math.min(t, dx > 0 ? (r.x + r.w - origin.x) / dx : (r.x - origin.x) / dx);
  if (Math.abs(dy) > 1e-9) t = Math.min(t, dy > 0 ? (r.y + r.h - origin.y) / dy : (r.y - origin.y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

function rectEquals(a: Rect, b: Rect, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

/**
 * Distance from `origin` along `dir` at which an axis-aligned ray first enters `r`,
 * or `null` when it never does. Origins already inside `r` return `null`: no amount of
 * shortening gets such a ray out of the rect.
 */
function rayEntry(origin: Vec, dir: Vec, r: Rect): number | null {
  const l = Math.hypot(dir.x, dir.y);
  if (l < 1e-9) return null;
  const dx = dir.x / l;
  const dy = dir.y / l;
  let enter = -Infinity;
  let exit = Infinity;
  if (Math.abs(dx) > 1e-9) {
    const t1 = (r.x - origin.x) / dx;
    const t2 = (r.x + r.w - origin.x) / dx;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
  } else if (origin.x < r.x || origin.x > r.x + r.w) {
    return null;
  }
  if (Math.abs(dy) > 1e-9) {
    const t1 = (r.y - origin.y) / dy;
    const t2 = (r.y + r.h - origin.y) / dy;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
  } else if (origin.y < r.y || origin.y > r.y + r.h) {
    return null;
  }
  if (enter > exit || exit < 0) return null;
  return enter > 0 ? enter : null;
}

/** Clearance kept between a shortened exit stub and the obstacle that forced the cut. */
const STUB_CLAMP_MARGIN = 1;

/**
 * Length of the exit stub. It must clear the node the endpoint sits on (`minStub`), but
 * it must also not *end inside* some other obstacle — a stub that overshoots into a
 * neighbouring node leaves every candidate route starting from an illegal point, and the
 * router then has nothing clean to choose between.
 */
function resolveStub(origin: Vec, facing: Vec | undefined, desired: number, minStub: number, obstacles: Rect[], owner?: Rect): number {
  if (isZero(facing) || desired <= minStub) return Math.max(desired, minStub);
  let limit = Infinity;
  for (const r of obstacles) {
    if (owner && rectEquals(r, owner)) continue;
    if (rectContains(r, origin)) continue;
    const t = rayEntry(origin, facing!, r);
    if (t !== null && t < limit) limit = t;
  }
  if (!Number.isFinite(limit)) return desired;
  return Math.max(minStub, Math.min(desired, limit - STUB_CLAMP_MARGIN));
}

function rectCenter(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** How far off-axis a port normal has to point before its stub is drawn as a diagonal. */
const DIAGONAL_MIN = 0.08;
/** The snapped diagonal may not swing more than ~40° away from the port normal. */
const DIAGONAL_APPROACH_MIN = 0.77;
/** How much further than the plain stub a snapped diagonal may reach, in grid steps. */
const DIAGONAL_REACH = 1.5;

/** True when a facing points somewhere other than straight up, down, left or right. */
function isDiagonalFacing(v?: Vec): boolean {
  if (isZero(v)) return false;
  const l = Math.hypot(v!.x, v!.y);
  return Math.min(Math.abs(v!.x), Math.abs(v!.y)) / l > DIAGONAL_MIN;
}

/** True when the segment `a`→`b` runs into `r` before it gets there. */
function segmentEnters(a: Vec, b: Vec, r: Rect): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-9) return rectContains(r, a);
  const t = rayEntry(a, d, r);
  return t !== null && t < len - 1e-6;
}

/**
 * Put the far end of a diagonal stub on a grid intersection.
 *
 * A port on a curve faces whichever way the curve does, so the route has to leave it at an
 * angle before it can turn orthogonal. Left alone that turn happens wherever the stub
 * ended — a few pixels off the grid, which reads as a wobble in an otherwise grid-aligned
 * drawing. Landing it on an intersection instead means the diagonal starts on a grid
 * corner and the orthogonal run leaves along a drawn grid line.
 *
 * Candidates are the intersections around the stub end; one is only taken if it still
 * leaves the port roughly the way the port faces, still clears the node the port sits on,
 * and does not put the diagonal through anything. Otherwise the plain stub stands.
 */
function snapStubToGrid(
  stub: Vec,
  ep: RouteEndpoint,
  opts: RouteOptions,
  obstacles: Rect[],
  owner?: Rect,
): Vec {
  const step = opts.grid ?? 0;
  if (step <= 0 || !isDiagonalFacing(ep.facing)) return stub;
  const origin = opts.gridOrigin ?? { x: 0, y: 0 };
  const l = Math.hypot(ep.facing!.x, ep.facing!.y) || 1;
  const facing = { x: ep.facing!.x / l, y: ep.facing!.y / l };
  const gx = Math.round((stub.x - origin.x) / step);
  const gy = Math.round((stub.y - origin.y) / step);
  const reach = dist(ep.pos, stub) + step * DIAGONAL_REACH;

  let best: Vec | null = null;
  let bestScore = Infinity;
  for (let ix = -1; ix <= 1; ix += 1) {
    for (let iy = -1; iy <= 1; iy += 1) {
      const c = { x: (gx + ix) * step + origin.x, y: (gy + iy) * step + origin.y };
      const away = { x: c.x - ep.pos.x, y: c.y - ep.pos.y };
      const len = Math.hypot(away.x, away.y);
      if (len < 1e-6 || len > reach) continue;
      const along = (away.x * facing.x + away.y * facing.y) / len;
      if (along < DIAGONAL_APPROACH_MIN) continue;
      if (owner && rectContains(owner, c)) continue;
      const blocked = obstacles.some((r) => {
        if (owner && rectEquals(r, owner)) return false;
        if (rectContains(r, ep.pos)) return false;
        return rectContains(r, c) || segmentEnters(ep.pos, c, r);
      });
      if (blocked) continue;
      // Nearest intersection, with a nudge towards the one straight ahead of the port.
      const score = dist(stub, c) + (1 - along) * step;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return best ?? stub;
}

/** True if `b` lies between `a` and `c` (inclusive), used to reject reversal "collinear" triples. */
function isBetween(a: number, b: number, c: number, eps = 1e-6): boolean {
  return b >= Math.min(a, c) - eps && b <= Math.max(a, c) + eps;
}

function dedupePoints(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/**
 * Drop mid points that lie on the straight line between their neighbours. Requires the
 * mid point to be monotonically *between* its neighbours on the shared axis so a
 * doubling-back point (e.g. an exit stub behind the path's overall direction) is never
 * silently collapsed into a single pass-through segment.
 */
function simplify(points: Vec[]): Vec[] {
  const pts = dedupePoints(points);
  if (pts.length < 3) return pts;
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6 && isBetween(a.y, b.y, c.y)) ||
      (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6 && isBetween(a.x, b.x, c.x));
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function stubPoint(ep: RouteEndpoint, stub: number): Vec {
  if (isZero(ep.facing)) return ep.pos;
  const f = ep.facing!;
  const l = Math.hypot(f.x, f.y) || 1;
  return { x: ep.pos.x + (f.x / l) * stub, y: ep.pos.y + (f.y / l) * stub };
}

/** Elbow between two points, choosing the axis order from the exit directions. */
function elbow(a: Vec, b: Vec, preferHorizontal: boolean): Vec[] {
  if (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6) return [a, b];
  return preferHorizontal ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}

function segmentHitsRect(a: Vec, b: Vec, r: Rect): boolean {
  if (Math.abs(a.y - b.y) < 1e-6) {
    const y = a.y;
    if (y < r.y || y > r.y + r.h) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi >= r.x && lo <= r.x + r.w;
  }
  if (Math.abs(a.x - b.x) < 1e-6) {
    const x = a.x;
    if (x < r.x || x > r.x + r.w) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi >= r.y && lo <= r.y + r.h;
  }
  return rectContains(r, a) || rectContains(r, b);
}

interface OwnerExemption {
  rect: Rect;
  /** The point where the route legitimately leaves (or arrives at) this owner's bounds. */
  stubEnd: Vec;
}

function pathCost(
  points: Vec[],
  obstacles: Rect[],
  exemptFirst?: OwnerExemption,
  exemptLast?: OwnerExemption,
): { cost: number; collisions: number } {
  let cost = 0;
  let collisions = 0;
  const lastIdx = points.length - 1;
  for (let i = 1; i < points.length; i += 1) {
    cost += dist(points[i - 1], points[i]);
    const isFirst = i === 1;
    const isLast = i === lastIdx;
    for (const r of obstacles) {
      let a = points[i - 1];
      let b = points[i];
      if (isFirst && exemptFirst && rectEquals(r, exemptFirst.rect)) {
        // Only the stub-to-neighbour remainder is a real segment; a→stubEnd legitimately
        // touches the owner's own bounds and must never be penalised.
        a = exemptFirst.stubEnd;
      } else if (isLast && exemptLast && rectEquals(r, exemptLast.rect)) {
        b = exemptLast.stubEnd;
      }
      if (segmentHitsRect(a, b, r)) {
        cost += 4000;
        collisions += 1;
      }
    }
  }
  cost += points.length * 8;
  return { cost, collisions };
}

/** Max number of general (non-owner) obstacles considered for geometry-derived detour lanes. */
const MAX_LANE_OBSTACLES = 4;

/** Four axis-aligned lanes that pass just outside `r`, connecting `sa` to `sb` around it. */
function laneCandidates(sa: Vec, sb: Vec, r: Rect): Vec[][] {
  const eps = 1;
  const topY = r.y - eps;
  const bottomY = r.y + r.h + eps;
  const leftX = r.x - eps;
  const rightX = r.x + r.w + eps;
  return [
    [{ x: sa.x, y: topY }, { x: sb.x, y: topY }],
    [{ x: sa.x, y: bottomY }, { x: sb.x, y: bottomY }],
    [{ x: leftX, y: sa.y }, { x: leftX, y: sb.y }],
    [{ x: rightX, y: sa.y }, { x: rightX, y: sb.y }],
  ];
}

function candidateKey(points: Vec[]): string {
  return points.map((p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`).join('|');
}

/**
 * Orthogonal (manhattan) route between two endpoints.
 *
 * The primary engine is an A* search over a sparse routing lattice built from the
 * obstacles' own edges (see `astar.ts`), so a connector staircases around any arrangement
 * of nodes instead of picking the least-bad of a few hard-coded elbow shapes. The legacy
 * candidate search is kept as a fallback for the cases A* declines: a lattice too large to
 * search, or genuinely enclosed endpoints where *no* clean path exists.
 *
 * Tightly packed (or overlapping) nodes can inflate into each other so that no route is
 * collision-free at the requested clearance. Rather than surrender and draw straight
 * through a box, the search is retried with progressively smaller clearances.
 */
export function routeOrthogonal(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions = {}): Vec[] {
  return routeOrthogonalBest([from], [to], opts).points;
}

/** What a route settled on: the polyline, and which candidate end it chose at each side. */
export interface RouteChoice {
  points: Vec[];
  from: RouteEndpoint;
  to: RouteEndpoint;
}

/**
 * As `routeOrthogonal`, but each end may offer several candidate places to attach and the
 * search picks the pair that gives the cheapest route. Every candidate is fed to A* at once
 * rather than routed separately, so this costs one search, not one per pair.
 */
export function routeOrthogonalBest(
  fromList: RouteEndpoint[],
  toList: RouteEndpoint[],
  opts: RouteOptions = {},
): RouteChoice {
  const from = fromList[0];
  const to = toList[0];
  const baseClearance = opts.clearance ?? 8;
  const ladder = [baseClearance];
  if (baseClearance > 0) {
    for (const factor of [0.5, 0.25, 0]) {
      const value = baseClearance * factor;
      if (!ladder.some((existing) => Math.abs(existing - value) < 1e-6)) ladder.push(value);
    }
  }

  const useAStar = (opts.router ?? 'auto') !== 'simple';
  const onGrid = (opts.grid ?? 0) > 0;
  let fallback: { points: Vec[]; collisions: number } | null = null;
  for (const clearance of ladder) {
    if (useAStar) {
      // Grid lanes first, so a route runs along the drawn grid wherever that is possible.
      const snapped = onGrid ? routeWithAStar(fromList, toList, opts, clearance, 'grid') : null;
      if (snapped) return snapped;
      const searched = routeWithAStar(fromList, toList, opts, clearance, 'lanes');
      if (searched) return searched;
    }
    // The legacy engine scores hand-written elbow shapes and has no notion of choosing an
    // end, so it is only ever asked about the pair the caller nominated first.
    const attempt = routeAtClearance(from, to, opts, clearance);
    if (attempt.collisions === 0) return { points: attempt.points, from, to };
    if (!fallback || attempt.collisions < fallback.collisions) fallback = attempt;
  }
  return { points: fallback!.points, from, to };
}

interface StubGeometry {
  /** Obstacles inflated by the clearance in force. */
  obstacles: Rect[];
  fromOwner?: Rect;
  toOwner?: Rect;
  /** Where the route leaves the source port, and arrives at the target port. */
  sa: Vec;
  sb: Vec;
}

/**
 * Room the stub needs beside the node it leaves, once clearance has been shared out.
 *
 * A node barely narrower than the corridor it sits in cannot have the full clearance on both
 * its own bounds and the wall beside it — the room is simply not there. What made connectors
 * hug walls for their whole length was the response to that: the clearance ladder dropped the
 * *entire* route to whatever the tightest endpoint could manage. Clearance is instead resolved
 * per obstacle, so one pinched endpoint costs clearance only where it is pinched.
 */
const PINCH_MARGIN = 1;

/** Separation between two rects along their most-separated axis; 0 when they overlap. */
function rectGap(a: Rect, b: Rect): number {
  return Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), a.y - (b.y + b.h), b.y - (a.y + a.h)));
}

/**
 * Clearance for one obstacle, reduced only where an endpoint's own node is too close for the
 * pair of them to have the full amount. Obstacles clear of both endpoints keep all of it.
 */
function pinchedClearance(r: Rect, owners: (Rect | undefined)[], clearance: number): number {
  let out = clearance;
  for (const owner of owners) {
    if (!owner) continue;
    const gap = rectGap(r, owner);
    if (gap >= clearance * 2 + PINCH_MARGIN) continue;
    out = Math.min(out, Math.max(0, (gap - PINCH_MARGIN) / 2));
  }
  return out;
}

/** Stub ends and inflated obstacles, shared by both routing engines so they agree. */
function stubGeometry(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions, clearance: number): StubGeometry {
  const raw = opts.obstacles ?? [];
  const owners = [opts.fromOwnerBounds, opts.toOwnerBounds];
  const obstacles = raw.map((r) => inflate(r, pinchedClearance(r, owners, clearance)));
  // An owner is inflated by what is left over beside it, so its stub cannot be pushed into a
  // wall the obstacle pass has already agreed to stay out of. Obstacles it already touches say
  // nothing about the room around it and are ignored here.
  const ownerClearance = (owner?: Rect): number => {
    if (!owner) return clearance;
    let out = clearance;
    for (const r of raw) {
      const gap = rectGap(r, owner);
      if (gap <= PINCH_MARGIN) continue;
      out = Math.min(out, Math.max(0, (gap - PINCH_MARGIN) / 2));
    }
    return out;
  };
  const fromOwner = opts.fromOwnerBounds ? inflate(opts.fromOwnerBounds, ownerClearance(opts.fromOwnerBounds)) : undefined;
  const toOwner = opts.toOwnerBounds ? inflate(opts.toOwnerBounds, ownerClearance(opts.toOwnerBounds)) : undefined;

  return {
    obstacles,
    fromOwner,
    toOwner,
    sa: stubAt(from, fromOwner, opts, obstacles),
    sb: stubAt(to, toOwner, opts, obstacles),
  };
}

/**
 * Where the route actually leaves one endpoint, once the room beside it is known.
 *
 * Split out from `stubGeometry` because it is the only part that varies between the
 * candidate places a sliding port might attach at: the clearance shared out among the
 * obstacles, and the inflation of each owning node, depend on the nodes alone. So the
 * expensive half is computed once and this runs per candidate.
 */
function stubAt(ep: RouteEndpoint, owner: Rect | undefined, opts: RouteOptions, obstacles: Rect[]): Vec {
  const stub = opts.stub ?? 16;
  const minStub = owner ? exitDistance(ep.pos, ep.facing ?? { x: 0, y: 0 }, owner) + 1 : 0;
  const distance = resolveStub(ep.pos, ep.facing, Math.max(stub, minStub), minStub, obstacles, owner);
  return snapStubToGrid(stubPoint(ep, distance), ep, opts, obstacles, owner);
}

/** A* attempt at one clearance. Returns null when the lattice has no collision-free path. */
function routeWithAStar(
  fromList: RouteEndpoint[],
  toList: RouteEndpoint[],
  opts: RouteOptions,
  clearance: number,
  mode: 'grid' | 'lanes',
): RouteChoice | null {
  const geo = stubGeometry(fromList[0], toList[0], opts, clearance);
  const stubOf = new Map<RouteEndpoint, Vec>();
  for (const ep of fromList) stubOf.set(ep, stubAt(ep, geo.fromOwner, opts, geo.obstacles));
  for (const ep of toList) stubOf.set(ep, stubAt(ep, geo.toOwner, opts, geo.obstacles));
  const grid = mode === 'grid' ? gridLattice(geo, geo.obstacles, opts) : null;
  if (mode === 'grid' && !grid) return null;
  const terminal = (ep: RouteEndpoint): AStarTerminal => ({
    point: stubOf.get(ep)!,
    axis: axisOf(ep.facing),
    dir: ep.facing,
    // What this spot costs before the search starts travelling: the stub that reaches it.
    // Candidates on one shape differ here — a diagonal lead-in off a ring is longer than a
    // square one — so charging it is what makes the search pick the shortest whole
    // connector rather than the shortest lattice path.
    cost: dist(ep.pos, stubOf.get(ep)!),
  });
  const search = (from: RouteEndpoint[], to: RouteEndpoint[]) =>
    routeAStar(from.map(terminal), to.map(terminal), {
      obstacles: geo.obstacles,
      // Lines through the ports themselves and a mid lane, so the classic centre-split
      // Z-route is always available even when no obstacle happens to sit on that line.
      extraX: grid ? grid.xs : [...fromList.map((e) => e.pos.x), ...toList.map((e) => e.pos.x), (geo.sa.x + geo.sb.x) / 2],
      extraY: grid ? grid.ys : [...fromList.map((e) => e.pos.y), ...toList.map((e) => e.pos.y), (geo.sa.y + geo.sb.y) / 2],
      ...(grid
        ? {
            obstacleLanes: false,
            preferX: grid.xs,
            preferY: grid.ys,
            // Half a grid step: enough to settle a tied route onto the grid, never enough
            // to pay for the detour that leaving it would cost. It has nothing to do with
            // the bend cost, which used to cap it and so switched the preference off
            // altogether whenever corners were free.
            offLinePenalty: (opts.grid ?? 0) / 2,
          }
        : {}),
      bendPenalty: opts.bendPenalty ?? DEFAULT_BEND_PENALTY,
    });

  /*
   * The stubs are the one part of the route the search never sees: they run from the port
   * to the first lattice node, and for a surface port that segment is a diagonal across
   * whatever happens to lie beside the shape — very often the node's own caption.
   *
   * Failing the whole attempt on that used to throw away the search as well as the spot it
   * chose, and the fallback below picks no spot at all: it routes to whichever candidate
   * the caller happened to list first, which is an arbitrary point on the shape and reads
   * as the connector going the long way round. A dirty stub is a verdict on that candidate,
   * not on the sheet, so the candidate is dropped and the search repeated — the runner-up
   * is then the cheapest of what is left, which is the answer we wanted all along.
   */
  const raw = opts.obstacles ?? [];
  let fromLeft = fromList;
  let toLeft = toList;
  for (;;) {
    const found = search(fromLeft, toLeft);
    if (!found) return null;
    const from = fromLeft[found.startIndex];
    const to = toLeft[found.goalIndex];
    const full = simplify([from.pos, ...found.points, to.pos]);
    const dirty = dirtySegments(full, raw, from.pos, to.pos);
    if (dirty.length === 0) return { points: full, from, to };
    // Anything dirty away from the ends is the route itself hitting something, which no
    // other candidate can mend.
    const last = full.length - 1;
    if (dirty.some((i) => i !== 1 && i !== last)) return null;
    if (dirty.includes(last) && toLeft.length > 1) toLeft = toLeft.filter((ep) => ep !== to);
    else if (dirty.includes(1) && fromLeft.length > 1) fromLeft = fromLeft.filter((ep) => ep !== from);
    else return null;
  }
}

/**
 * True when the finished polyline crosses nothing it has no right to.
 *
 * Two things the search cannot see meet here. It is handed clearance-inflated obstacles and
 * lets an endpoint escape whatever it starts inside — right for a port that genuinely overlaps
 * its neighbour, wrong when the inflation is what put it there, because then a node slightly
 * too big for the corridor it sits in is granted a free pass through the wall beside it. And it
 * never sees the stub segments at all: they run from the port to the first lattice node, and for
 * a surface port that segment is a diagonal.
 *
 * So the whole path, stubs included, is re-checked against the *raw* obstacles, exempting only
 * the ones an endpoint is really inside. Which segments failed is what the caller acts on: a
 * dirty stub condemns the attach point it belongs to, a dirty middle condemns the route.
 */
function dirtySegments(points: Vec[], raw: Rect[], a: Vec, b: Vec): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    for (const r of raw) {
      if (insideStrict(r, a) || insideStrict(r, b)) continue;
      if (segmentEntersInterior(points[i - 1], points[i], r)) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

function insideStrict(r: Rect, p: Vec): boolean {
  const eps = 1e-6;
  return p.x > r.x + eps && p.x < r.x + r.w - eps && p.y > r.y + eps && p.y < r.y + r.h - eps;
}

/**
 * Segment/rect interior overlap for a segment at any angle (Liang-Barsky clip). Mere contact
 * with an edge does not count, and the diagonal stub a surface port produces is handled as
 * readily as the axis-aligned body of a route.
 */
function segmentEntersInterior(a: Vec, b: Vec, r: Rect): boolean {
  const eps = 1e-6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < eps) return q >= -eps;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - r.x)) return false;
  if (!clip(dx, r.x + r.w - a.x)) return false;
  if (!clip(-dy, a.y - r.y)) return false;
  if (!clip(dy, r.y + r.h - a.y)) return false;
  if (t1 - t0 < eps) return false;
  const t = (t0 + t1) / 2;
  return insideStrict(r, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Grid multiples of `step` covering [min, max], or null when the step is not usable. */
function gridRange(step: number, origin: number, min: number, max: number): number[] | null {
  const first = Math.ceil((min - origin) / step - 1e-6) * step + origin;
  const count = Math.floor((max - first) / step + 1e-6) + 1;
  if (!Number.isFinite(count) || count < 1) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(first + i * step);
  return out;
}

/**
 * Lattice of document grid lines around the route, plus the two stub coordinates so the
 * ports themselves stay reachable. Null when there is no usable grid, in which case the
 * caller falls back to the obstacle-derived lattice.
 */
function gridLattice(
  geo: StubGeometry,
  obstacles: Rect[],
  opts: RouteOptions,
): { xs: number[]; ys: number[] } | null {
  const step = opts.grid ?? 0;
  if (!Number.isFinite(step) || step <= 0) return null;
  const origin = opts.gridOrigin ?? { x: 0, y: 0 };

  // Start from the endpoints, then take in any obstacle that straddles that span, so the
  // search has lanes to get around it rather than only between the ports.
  let box = rectFromPoints(geo.sa, geo.sb);
  box = inflate(box, step * 2);
  for (const r of obstacles) if (rectIntersects(r, box)) box = rectUnion(box, r);
  box = inflate(box, step * 2);

  const xs = gridRange(step, origin.x, box.x, box.x + box.w);
  const ys = gridRange(step, origin.y, box.y, box.y + box.h);
  if (!xs || !ys) return null;
  // The stub coordinates themselves are added by the search, which always includes its
  // start and goal lines; keeping them out here leaves them un-preferred.
  return { xs, ys };
}

/** Corner cost for the A* router: about two grid steps, so it prefers straight over short. */
const DEFAULT_BEND_PENALTY = 25;

function routeAtClearance(
  from: RouteEndpoint,
  to: RouteEndpoint,
  opts: RouteOptions,
  clearance: number,
): { points: Vec[]; collisions: number } {
  const stub = opts.stub ?? 16;
  const { obstacles, fromOwner: fromOwnerInflated, toOwner: toOwnerInflated, sa, sb } = stubGeometry(
    from,
    to,
    opts,
    clearance,
  );

  const a = from.pos;
  const b = to.pos;

  const aHorizontal = !isZero(from.facing) ? Math.abs(from.facing!.x) >= Math.abs(from.facing!.y) : null;
  const bHorizontal = !isZero(to.facing) ? Math.abs(to.facing!.x) >= Math.abs(to.facing!.y) : null;

  const midX = (sa.x + sb.x) / 2;
  const midY = (sa.y + sb.y) / 2;

  const candidates: Vec[][] = [];
  const wrap = (mid: Vec[]): Vec[] => simplify([a, sa, ...mid, sb, b]);

  candidates.push(wrap(elbow(sa, sb, true).slice(1, -1)));
  candidates.push(wrap(elbow(sa, sb, false).slice(1, -1)));
  candidates.push(wrap([{ x: midX, y: sa.y }, { x: midX, y: sb.y }]));
  candidates.push(wrap([{ x: sa.x, y: midY }, { x: sb.x, y: midY }]));

  const detour = Math.max(stub * 2, 32);
  for (const sign of [1, -1]) {
    candidates.push(
      wrap([
        { x: sa.x, y: sa.y + detour * sign },
        { x: sb.x, y: sa.y + detour * sign },
      ]),
    );
    candidates.push(
      wrap([
        { x: sa.x + detour * sign, y: sa.y },
        { x: sa.x + detour * sign, y: sb.y },
      ]),
    );
  }

  // Candidates derived from the obstacles' own geometry, so a route can go around a large
  // node instead of merely offsetting by a small constant that a large obstacle swallows.
  const laneRects: Rect[] = [];
  const addLaneRect = (r?: Rect): void => {
    if (r && !laneRects.some((existing) => rectEquals(existing, r))) laneRects.push(r);
  };
  addLaneRect(fromOwnerInflated);
  addLaneRect(toOwnerInflated);
  const mid = { x: midX, y: midY };
  const nearest = [...obstacles]
    .filter((r) => !laneRects.some((existing) => rectEquals(existing, r)))
    .sort((r1, r2) => dist(mid, rectCenter(r1)) - dist(mid, rectCenter(r2)))
    .slice(0, MAX_LANE_OBSTACLES);
  for (const r of nearest) addLaneRect(r);
  for (const r of laneRects) {
    for (const lane of laneCandidates(sa, sb, r)) candidates.push(wrap(lane));
  }

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const fromExemption: OwnerExemption | undefined = fromOwnerInflated ? { rect: fromOwnerInflated, stubEnd: sa } : undefined;
  const toExemption: OwnerExemption | undefined = toOwnerInflated ? { rect: toOwnerInflated, stubEnd: sb } : undefined;

  let best = uniqueCandidates[0];
  let bestCost = Infinity;
  let bestCollisions = Infinity;
  for (const candidate of uniqueCandidates) {
    const scored = pathCost(candidate, obstacles, fromExemption, toExemption);
    let cost = scored.cost;
    // Penalise routes whose first/last segment fights the port normal.
    if (aHorizontal !== null && candidate.length > 2) {
      const seg = candidate[1];
      const horizontal = Math.abs(seg.y - a.y) < 1e-6;
      if (horizontal !== aHorizontal) cost += 300;
    }
    if (bHorizontal !== null && candidate.length > 2) {
      const seg = candidate[candidate.length - 2];
      const horizontal = Math.abs(seg.y - b.y) < 1e-6;
      if (horizontal !== bHorizontal) cost += 300;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestCollisions = scored.collisions;
      best = candidate;
    }
  }
  return { points: best, collisions: bestCollisions };
}

export function routeStraight(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions = {}): Vec[] {
  return simplify([from.pos, ...(opts.waypoints ?? []), to.pos]);
}

/** Points for a curved route; the caller turns these into a smooth path. */
export function routeCurve(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions = {}): Vec[] {
  const stub = opts.stub ?? Math.max(24, dist(from.pos, to.pos) * 0.25);
  const pts = [from.pos];
  if (!isZero(from.facing)) pts.push(stubPoint(from, stub));
  pts.push(...(opts.waypoints ?? []));
  if (!isZero(to.facing)) pts.push(stubPoint(to, stub));
  pts.push(to.pos);
  return dedupePoints(pts);
}

export function route(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions = {}): Vec[] {
  const style = opts.style ?? 'orthogonal';
  if (style === 'straight') return routeStraight(from, to, opts);
  if (style === 'curve') return routeCurve(from, to, opts);
  if (opts.waypoints && opts.waypoints.length > 0) {
    const pts: Vec[] = [from.pos];
    let prev: RouteEndpoint = from;
    const waypoints = opts.waypoints;
    for (let i = 0; i < waypoints.length; i += 1) {
      const wp = waypoints[i];
      const segOpts: RouteOptions = {
        ...opts,
        waypoints: [],
        fromOwnerBounds: i === 0 ? opts.fromOwnerBounds : undefined,
        toOwnerBounds: undefined,
      };
      pts.push(...routeOrthogonal(prev, { pos: wp }, segOpts).slice(1));
      prev = { pos: wp };
    }
    pts.push(...routeOrthogonal(prev, to, { ...opts, waypoints: [], fromOwnerBounds: undefined }).slice(1));
    return simplify(pts);
  }
  return routeOrthogonal(from, to, opts);
}

/** Half-angle between an arrowhead's axis and each of its barbs. */
export const ARROW_HEAD_SPREAD = 0.42;

/** Arrowhead polygon points for a route ending at `tip`. */
export function arrowHead(tip: Vec, from: Vec, size = 10, spread = ARROW_HEAD_SPREAD): Vec[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const angle = Math.atan2(dy, dx);
  const s = clamp(size, 2, 200);
  return [
    tip,
    { x: tip.x - Math.cos(angle - spread) * s, y: tip.y - Math.sin(angle - spread) * s },
    { x: tip.x - Math.cos(angle + spread) * s, y: tip.y - Math.sin(angle + spread) * s },
  ];
}

/**
 * How far back along the route an arrowhead of this size reaches — the distance from its tip
 * to the line joining its barbs. Trim a stroke by this much and its cap ends up inside the
 * head rather than poking out in front of the tip.
 */
export function arrowHeadDepth(size = 10, spread = ARROW_HEAD_SPREAD): number {
  return clamp(size, 2, 200) * Math.cos(spread);
}
