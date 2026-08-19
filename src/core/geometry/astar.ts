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
  /** Axis the route already travels on when it arrives at `start` (free to continue). */
  startAxis?: Axis | null;
  /** Axis the route should arrive on at `goal`; anything else costs a bend. */
  goalAxis?: Axis | null;
  /**
   * Outward normal of the port the route leaves. The first move may not double back
   * along it, which would retrace the exit stub and leave a spur at the port.
   */
  startDir?: Vec | null;
  /** Outward normal of the port the route arrives at; the last move may not run along it. */
  goalDir?: Vec | null;
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
  /** Give up (return null) rather than search a lattice bigger than this. */
  maxNodes?: number;
}

const EPS = 1e-6;
/** How far outside an obstacle its routing lanes run. */
const LANE_OFFSET = 1;

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
 * Shortest orthogonal path from `start` to `goal` that never crosses an obstacle
 * interior, or `null` when the lattice has no such path (or is too large to search).
 * The returned polyline includes both endpoints and has no redundant collinear points.
 */
export function routeAStar(start: Vec, goal: Vec, opts: AStarOptions): Vec[] | null {
  const obstacles = opts.obstacles ?? [];
  const bend = opts.bendPenalty ?? 25;
  const maxNodes = opts.maxNodes ?? 6000;

  const lanes = opts.obstacleLanes !== false;
  const xs = uniqSorted([
    start.x,
    goal.x,
    ...(opts.extraX ?? []),
    ...(lanes ? obstacles.flatMap((r) => [r.x - LANE_OFFSET, r.x + r.w + LANE_OFFSET]) : []),
  ]);
  const ys = uniqSorted([
    start.y,
    goal.y,
    ...(opts.extraY ?? []),
    ...(lanes ? obstacles.flatMap((r) => [r.y - LANE_OFFSET, r.y + r.h + LANE_OFFSET]) : []),
  ]);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny > maxNodes) return null;

  const startI = indexOf(xs, start.x);
  const startJ = indexOf(ys, start.y);
  const goalI = indexOf(xs, goal.x);
  const goalJ = indexOf(ys, goal.y);
  if (startI < 0 || startJ < 0 || goalI < 0 || goalJ < 0) return null;
  const startNode = startJ * nx + startI;
  const goalNode = goalJ * nx + goalI;

  // An endpoint can legitimately sit inside an obstacle (a port on a node that overlaps a
  // neighbour). Those rects are ignored for the moves that escape to or from that endpoint,
  // otherwise the search would be walled in before it began.
  const startBlockers = obstacles.filter((r) => insideStrict(r, start));
  const goalBlockers = obstacles.filter((r) => insideStrict(r, goal));

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
  blocked[startNode] = 0;
  blocked[goalNode] = 0;

  /** Exact test used only for the handful of edges touching an endpoint. */
  const endpointEdgeOpen = (a: Vec, b: Vec, from: number, to: number): boolean => {
    for (const r of obstacles) {
      if ((from === startNode || to === startNode) && startBlockers.includes(r)) continue;
      if ((from === goalNode || to === goalNode) && goalBlockers.includes(r)) continue;
      if (crossesInterior(a, b, r)) return false;
    }
    return true;
  };

  // State = lattice node plus the axis travelled to reach it, so corners can be charged.
  const stateCount = nx * ny * 2;
  const g = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const heap = new Heap();
  const h = (i: number, j: number): number => Math.abs(xs[i] - goal.x) + Math.abs(ys[j] - goal.y);

  const startAxis = opts.startAxis ?? null;
  for (const axis of ['h', 'v'] as Axis[]) {
    const state = startNode * 2 + (axis === 'h' ? 0 : 1);
    const cost = startAxis === null || startAxis === axis ? 0 : bend;
    g[state] = cost;
    heap.push(cost + h(startI, startJ), state);
  }

  const goalAxis = opts.goalAxis ?? null;
  // Signed components of the two port normals, used to forbid stub-retracing moves.
  const startBackAxis = axisOf(opts.startDir);
  const startBack = startBackAxis === null ? null : -(startBackAxis === 'h' ? opts.startDir!.x : opts.startDir!.y);
  const goalOutAxis = axisOf(opts.goalDir);
  const goalOut = goalOutAxis === null ? null : goalOutAxis === 'h' ? opts.goalDir!.x : opts.goalDir!.y;
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
    if (node === goalNode) {
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
      // Never retrace the exit stub, and never arrive at the target port from its own
      // far side: both produce a spur doubling back over the stub.
      if (node === startNode && startBack !== null && nextAxis === startBackAxis && move * startBack > 0) return;
      if (next === goalNode && goalOut !== null && nextAxis === goalOutAxis && move * goalOut > 0) return;
      const touchesEndpoint = node === startNode || next === startNode || node === goalNode || next === goalNode;
      if (touchesEndpoint) {
        if (!endpointEdgeOpen(here, there, node, next)) return;
      } else {
        const edge = nextAxis === 'h' ? blockedH[j * nx + Math.min(i, ni)] : blockedV[Math.min(j, nj) * nx + i];
        if (edge) return;
      }
      let step = nextAxis === 'h' ? Math.abs(there.x - here.x) : Math.abs(there.y - here.y);
      if (nextAxis !== axis) step += bend;
      if (next === goalNode && goalAxis !== null && nextAxis !== goalAxis) step += bend;
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
  return points;
}
