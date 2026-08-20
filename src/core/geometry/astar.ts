import type { Rect, Vec } from './index';

/**
 * Orthogonal A* over a sparse routing lattice.
 *
 * Instead of scoring a handful of hand-written elbow shapes, the router builds the grid
 * of "interesting" lines — one just outside each side of every obstacle, plus the lines
 * through the endpoints and a mid lane — and searches it. Any staircase around any number
 * of obstacles is reachable, and the result is optimal for the cost model (length plus a
 * penalty per bend), so routes stay short, straight and predictable.
 */

export type Axis = 'h' | 'v';

export interface AStarOptions {
  /** Obstacles, already inflated by the desired clearance. */
  obstacles: Rect[];
  /** Extra lattice lines, e.g. the port coordinates or a mid lane. */
  extraX?: number[];
  extraY?: number[];
  /**
   * Whether to add a lane just outside each obstacle side (the default). Turn it off to
   * search a caller-supplied lattice only, e.g. one made of the document's grid lines.
   */
  obstacleLanes?: boolean;
  /** Cost of a corner, in world units. Higher means straighter, longer routes. */
  bendPenalty?: number;
  /**
   * Lines the route should prefer to travel along (e.g. the document grid). Any move
   * along a line outside these sets costs `offLinePenalty` extra, which breaks ties
   * towards grid-aligned routes without forbidding the others.
   */
  preferX?: number[];
  preferY?: number[];
  offLinePenalty?: number;
}

/**
 * One place a route is allowed to begin or end.
 *
 * A connector that lands anywhere on a shape offers many of these — one per candidate spot
 * on the outline — and the search picks between them itself rather than being told which to
 * use. See `routeAStar`.
 */
export interface AStarTerminal {
  /** Where the route touches the lattice, i.e. the far end of the port's exit stub. */
  point: Vec;
  /** Axis the route already travels on here; anything else costs a bend. */
  axis?: Axis | null;
  /**
   * Outward normal of the port. The route may not double back along it, which would
   * retrace the exit stub and leave a spur at the port.
   */
  dir?: Vec | null;
  /** What choosing this terminal costs before any travelling, in world units. */
  cost?: number;
}

/** Which terminals a finished route ended up using, and the route itself. */
export interface AStarResult {
  points: Vec[];
  startIndex: number;
  goalIndex: number;
}

const EPS = 1e-6;
/** How far outside an obstacle its routing lanes run. */
const LANE_OFFSET = 1;

/**
 * Charged on every corner on top of the caller's bend cost.
 *
 * A bend cost of zero says "do not lengthen the route to save a corner". It does not say
 * corners are free to scatter, but that is what it used to mean: with no charge at all,
 * every monotone staircase between two points costs exactly the same, so the search
 * returned an arbitrary member of that plateau — the sideways jogs half way along an
 * otherwise straight run. This is far too small to outweigh any visible difference in
 * length and far larger than the float noise in summing one, so it only ever orders
 * routes that were already tied, and among those it picks the one with fewest corners.
 */
const BEND_TIEBREAK = 1e-4;

/** Dominant axis of a facing normal, or null when it has no preference. */
export const axisOf = (v: Vec | undefined | null): Axis | null => {
  if (!v || (Math.abs(v.x) < EPS && Math.abs(v.y) < EPS)) return null;
  return Math.abs(v.x) >= Math.abs(v.y) ? 'h' : 'v';
};

function uniqSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!Number.isFinite(v)) continue;
    if (out.length === 0 || Math.abs(out[out.length - 1] - v) > 1e-4) out.push(v);
  }
  return out;
}

/** True when `p` is strictly inside `r`; touching an edge is allowed. */
function insideStrict(r: Rect, p: Vec): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;
}

/** True when the axis-aligned segment a→b passes through the interior of `r`. */
function crossesInterior(a: Vec, b: Vec, r: Rect): boolean {
  if (Math.abs(a.y - b.y) < EPS) {
    if (a.y <= r.y + EPS || a.y >= r.y + r.h - EPS) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return Math.min(hi, r.x + r.w) - Math.max(lo, r.x) > EPS;
  }
  if (Math.abs(a.x - b.x) < EPS) {
    if (a.x <= r.x + EPS || a.x >= r.x + r.w - EPS) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return Math.min(hi, r.y + r.h) - Math.max(lo, r.y) > EPS;
  }
  return false;
}

/** Index of the lattice line equal to `value`, or -1. */
function indexOf(lines: number[], value: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Math.abs(lines[mid] - value) <= 1e-4) return mid;
    if (lines[mid] < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

interface Range {
  lo: number;
  hi: number;
}

const EMPTY_RANGE: Range = { lo: 1, hi: 0 };

/** Indices of the lines strictly between `min` and `max`. */
function strictRange(lines: number[], min: number, max: number): Range {
  let lo = 0;
  while (lo < lines.length && lines[lo] <= min + EPS) lo += 1;
  let hi = lines.length - 1;
  while (hi >= 0 && lines[hi] >= max - EPS) hi -= 1;
  return lo <= hi ? { lo, hi } : EMPTY_RANGE;
}

/**
 * Indices `i` whose span `[lines[i], lines[i + 1]]` overlaps `(min, max)` with positive
 * length — i.e. the edges that would pass through that extent.
 */
function spanRange(lines: number[], min: number, max: number): Range {
  let lo = 0;
  while (lo < lines.length - 1 && lines[lo + 1] <= min + EPS) lo += 1;
  let hi = lines.length - 2;
  while (hi >= 0 && lines[hi] >= max - EPS) hi -= 1;
  return lo <= hi ? { lo, hi } : EMPTY_RANGE;
}

/** Minimal binary heap keyed by f-score; ties break on insertion order for determinism. */
class Heap {
  private keys: number[] = [];
  private seq: number[] = [];
  private data: number[] = [];
  private counter = 0;

  get size(): number {
    return this.data.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.seq.push(this.counter);
    this.data.push(value);
    this.counter += 1;
    let i = this.data.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.data[0];
    const lastKey = this.keys.pop()!;
    const lastSeq = this.seq.pop()!;
    const lastValue = this.data.pop()!;
    if (this.data.length > 0) {
      this.keys[0] = lastKey;
      this.seq[0] = lastSeq;
      this.data[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < this.data.length && this.less(l, small)) small = l;
        if (r < this.data.length && this.less(r, small)) small = r;
        if (small === i) break;
        this.swap(i, small);
        i = small;
      }
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    if (this.keys[i] !== this.keys[j]) return this.keys[i] < this.keys[j];
    return this.seq[i] < this.seq[j];
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.seq[i], this.seq[j]] = [this.seq[j], this.seq[i]];
    [this.data[i], this.data[j]] = [this.data[j], this.data[i]];
  }
}

/**
 * Shortest orthogonal path from any one of `starts` to any one of `goals` that never
 * crosses an obstacle interior, or `null` when the lattice has no such path.
 *
 * Offering several terminals at each end is how a connector that may land anywhere on a
 * shape is routed. The alternative — routing every pair of candidate spots and keeping the
 * cheapest — is both far slower and not even reliable, because improving one end and then
 * the other is a descent that can settle in a local minimum. Instead every candidate is
 * seeded into the queue at once, which is the same thing as a single dummy node joined to
 * all of them by free edges, and the heuristic becomes the *smallest* estimate over the
 * goals. The minimum of admissible estimates is itself admissible, so the first goal the
 * search settles on is the best spot on either shape, proved in one pass.
 *
 * This is the standard treatment of a region endpoint: Lee's maze router seeds its
 * wavefront from every cell of a multi-cell source, and libavoid builds exactly this dummy
 * vertex per connector end (`ConnEnd::assignPinVisibilityTo`) with `min` over its candidate
 * targets in the heuristic (Wybrow, Marriott & Stuckey, "Orthogonal Connector Routing",
 * GD'09).
 *
 * The search is unbounded: it looks at whatever lattice the obstacles imply, however large
 * that turns out to be. The returned polyline includes both endpoints and has no redundant
 * collinear points.
 */
export function routeAStar(starts: AStarTerminal[], goals: AStarTerminal[], opts: AStarOptions): AStarResult | null {
  const obstacles = opts.obstacles ?? [];
  const bend = (opts.bendPenalty ?? 25) + BEND_TIEBREAK;
  if (starts.length === 0 || goals.length === 0) return null;

  const lanes = opts.obstacleLanes !== false;
  const xs = uniqSorted([
    ...starts.map((t) => t.point.x),
    ...goals.map((t) => t.point.x),
    ...(opts.extraX ?? []),
    ...(lanes ? obstacles.flatMap((r) => [r.x - LANE_OFFSET, r.x + r.w + LANE_OFFSET]) : []),
  ]);
  const ys = uniqSorted([
    ...starts.map((t) => t.point.y),
    ...goals.map((t) => t.point.y),
    ...(opts.extraY ?? []),
    ...(lanes ? obstacles.flatMap((r) => [r.y - LANE_OFFSET, r.y + r.h + LANE_OFFSET]) : []),
  ]);
  const nx = xs.length;
  const ny = ys.length;

  /** Terminals indexed by the lattice node they sit on, with what each one needs. */
  interface Seat {
    index: number;
    terminal: AStarTerminal;
    /**
     * Obstacles this terminal sits strictly inside. A port can legitimately be inside a
     * node that overlaps a neighbour, so those rects are ignored for the moves escaping to
     * or from it — otherwise the search would be walled in before it began.
     */
    blockers: Rect[];
  }
  const seat = (list: AStarTerminal[]): Map<number, Seat> => {
    const out = new Map<number, Seat>();
    list.forEach((terminal, index) => {
      const i = indexOf(xs, terminal.point.x);
      const j = indexOf(ys, terminal.point.y);
      if (i < 0 || j < 0) return;
      const node = j * nx + i;
      // Two candidates landing on the same lattice node are the same terminal to the
      // search; the cheaper one wins.
      const held = out.get(node);
      if (held && (held.terminal.cost ?? 0) <= (terminal.cost ?? 0)) return;
      out.set(node, { index, terminal, blockers: obstacles.filter((r) => insideStrict(r, terminal.point)) });
    });
    return out;
  };
  const startSeats = seat(starts);
  const goalSeats = seat(goals);
  if (startSeats.size === 0 || goalSeats.size === 0) return null;

  // Blocking is precomputed by marking each obstacle's covered index ranges rather than
  // testing every node/edge against every rect, so cost scales with the area obstacles
  // actually cover instead of nodes x obstacles.
  const blocked = new Uint8Array(nx * ny);
  /** Edge from (i,j) to (i+1,j). */
  const blockedH = new Uint8Array(nx * ny);
  /** Edge from (i,j) to (i,j+1). */
  const blockedV = new Uint8Array(nx * ny);
  for (const r of obstacles) {
    const insideI = strictRange(xs, r.x, r.x + r.w);
    const insideJ = strictRange(ys, r.y, r.y + r.h);
    for (let j = insideJ.lo; j <= insideJ.hi; j += 1) {
      for (let i = insideI.lo; i <= insideI.hi; i += 1) blocked[j * nx + i] = 1;
    }
    // A horizontal edge is blocked when its row is inside the rect and its span overlaps
    // the rect's x extent; the span condition gives one contiguous run of columns.
    const spanI = spanRange(xs, r.x, r.x + r.w);
    const spanJ = spanRange(ys, r.y, r.y + r.h);
    for (let j = insideJ.lo; j <= insideJ.hi; j += 1) {
      for (let i = spanI.lo; i <= spanI.hi; i += 1) blockedH[j * nx + i] = 1;
    }
    for (let i = insideI.lo; i <= insideI.hi; i += 1) {
      for (let j = spanJ.lo; j <= spanJ.hi; j += 1) blockedV[j * nx + i] = 1;
    }
  }
  for (const node of startSeats.keys()) blocked[node] = 0;
  for (const node of goalSeats.keys()) blocked[node] = 0;

  /** Exact test used only for the handful of edges touching an endpoint. */
  const endpointEdgeOpen = (a: Vec, b: Vec, from: number, to: number): boolean => {
    const exempt = [startSeats.get(from), startSeats.get(to), goalSeats.get(from), goalSeats.get(to)];
    for (const r of obstacles) {
      if (exempt.some((s) => s?.blockers.includes(r))) continue;
      if (crossesInterior(a, b, r)) return false;
    }
    return true;
  };

  // State = lattice node plus the axis travelled to reach it, so corners can be charged.
  const stateCount = nx * ny * 2;
  const g = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const heap = new Heap();
  /*
   * Distance to the nearest goal, which is what keeps the search admissible with more than
   * one of them: every individual estimate is a lower bound on the cost of reaching its own
   * goal, so the smallest of them is a lower bound on reaching the best goal. Overshoot any
   * one of them and A* could settle for a worse spot on the shape.
   */
  const goalPoints = [...goalSeats.values()].map((s) => s.terminal.point);
  const h = (i: number, j: number): number => {
    let best = Infinity;
    for (const p of goalPoints) best = Math.min(best, Math.abs(xs[i] - p.x) + Math.abs(ys[j] - p.y));
    return best;
  };

  // Every candidate start is seeded at once, each carrying whatever choosing it costs.
  for (const [node, s] of startSeats) {
    const i = node % nx;
    const j = (node - i) / nx;
    const wanted = s.terminal.axis ?? null;
    for (const axis of ['h', 'v'] as Axis[]) {
      const state = node * 2 + (axis === 'h' ? 0 : 1);
      const cost = (s.terminal.cost ?? 0) + (wanted === null || wanted === axis ? 0 : bend);
      if (cost >= g[state]) continue;
      g[state] = cost;
      heap.push(cost + h(i, j), state);
    }
  }

  /** Signed component of a port normal on its own axis, for forbidding stub retraces. */
  const backAlong = (dir: Vec | null | undefined, sign: number): { axis: Axis; value: number } | null => {
    const axis = axisOf(dir);
    if (axis === null) return null;
    return { axis, value: sign * (axis === 'h' ? dir!.x : dir!.y) };
  };
  // Which lattice lines the caller prefers to travel along (empty = no preference).
  const offLine = opts.offLinePenalty ?? 0;
  const preferredX = new Uint8Array(nx);
  const preferredY = new Uint8Array(ny);
  if (offLine > 0) {
    for (const v of opts.preferX ?? []) {
      const at = indexOf(xs, v);
      if (at >= 0) preferredX[at] = 1;
    }
    for (const v of opts.preferY ?? []) {
      const at = indexOf(ys, v);
      if (at >= 0) preferredY[at] = 1;
    }
  }
  let bestGoalState = -1;
  while (heap.size > 0) {
    const state = heap.pop();
    const node = state >> 1;
    const axis: Axis = state & 1 ? 'v' : 'h';
    const cost = g[state];
    // The first goal *popped* is the cheapest reachable one over every candidate pair.
    if (goalSeats.has(node)) {
      bestGoalState = state;
      break;
    }
    const i = node % nx;
    const j = (node - i) / nx;
    const here = { x: xs[i], y: ys[j] };

    const relax = (ni: number, nj: number, nextAxis: Axis): void => {
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) return;
      const next = nj * nx + ni;
      if (blocked[next]) return;
      const there = { x: xs[ni], y: ys[nj] };
      const move = nextAxis === 'h' ? there.x - here.x : there.y - here.y;
      const leaving = startSeats.get(node);
      const arriving = goalSeats.get(next);
      // Never retrace the exit stub, and never arrive at the target port from its own
      // far side: both produce a spur doubling back over the stub.
      const back = backAlong(leaving?.terminal.dir, -1);
      if (back && nextAxis === back.axis && move * back.value > 0) return;
      const out = backAlong(arriving?.terminal.dir, 1);
      if (out && nextAxis === out.axis && move * out.value > 0) return;
      const touchesEndpoint =
        leaving !== undefined ||
        arriving !== undefined ||
        startSeats.has(next) ||
        goalSeats.has(node);
      if (touchesEndpoint) {
        if (!endpointEdgeOpen(here, there, node, next)) return;
      } else {
        const edge = nextAxis === 'h' ? blockedH[j * nx + Math.min(i, ni)] : blockedV[Math.min(j, nj) * nx + i];
        if (edge) return;
      }
      let step = nextAxis === 'h' ? Math.abs(there.x - here.x) : Math.abs(there.y - here.y);
      if (nextAxis !== axis) step += bend;
      if (arriving) {
        const wanted = arriving.terminal.axis ?? null;
        if (wanted !== null && nextAxis !== wanted) step += bend;
        step += arriving.terminal.cost ?? 0;
      }
      // A run along a line the caller did not ask for (off the document grid) costs a
      // little extra, so equal-length routes settle onto the grid.
      if (offLine > 0 && (nextAxis === 'h' ? !preferredY[nj] : !preferredX[ni])) step += offLine;
      const nextState = next * 2 + (nextAxis === 'h' ? 0 : 1);
      const candidate = cost + step;
      if (candidate + 1e-9 >= g[nextState]) return;
      g[nextState] = candidate;
      cameFrom[nextState] = state;
      heap.push(candidate + h(ni, nj), nextState);
    };

    relax(i + 1, j, 'h');
    relax(i - 1, j, 'h');
    relax(i, j + 1, 'v');
    relax(i, j - 1, 'v');
  }

  if (bestGoalState < 0) return null;

  const nodes: number[] = [];
  for (let s = bestGoalState; s >= 0; s = cameFrom[s]) nodes.push(s >> 1);
  nodes.reverse();
  const startIndex = startSeats.get(nodes[0])?.index;
  const goalIndex = goalSeats.get(nodes[nodes.length - 1])?.index;
  if (startIndex === undefined || goalIndex === undefined) return null;

  const points: Vec[] = [];
  for (const node of nodes) {
    const i = node % nx;
    const j = (node - i) / nx;
    const p = { x: xs[i], y: ys[j] };
    const last = points[points.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    // Collapse runs of lattice nodes that lie on the same straight segment. The middle
    // point must be *between* its neighbours, so a genuine reversal is never merged away.
    const prev = points[points.length - 2];
    if (prev && last) {
      const between = (a: number, b: number, c: number): boolean =>
        b >= Math.min(a, c) - EPS && b <= Math.max(a, c) + EPS;
      const collinear =
        (Math.abs(prev.x - last.x) < EPS && Math.abs(last.x - p.x) < EPS && between(prev.y, last.y, p.y)) ||
        (Math.abs(prev.y - last.y) < EPS && Math.abs(last.y - p.y) < EPS && between(prev.x, last.x, p.x));
      if (collinear) points.pop();
    }
    points.push(p);
  }
  return { points, startIndex, goalIndex };
}
