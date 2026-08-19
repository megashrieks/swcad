import type { Rect } from '../geometry/index';

const QUANTUM = 1000;
const quantize = (v: number): number => Math.round(v * QUANTUM) / QUANTUM;

export interface AlignmentHit {
  coord: number;
  sources: string[];
  /** Distance from the queried value. */
  delta: number;
}

interface Axis {
  /** coordinate -> contributing source ids */
  map: Map<number, Set<string>>;
  keys: number[];
  dirty: boolean;
}

const newAxis = (): Axis => ({ map: new Map(), keys: [], dirty: false });

function axisAdd(axis: Axis, coord: number, source: string): void {
  const key = quantize(coord);
  let set = axis.map.get(key);
  if (!set) {
    set = new Set();
    axis.map.set(key, set);
    axis.keys.push(key);
    axis.dirty = true;
  }
  set.add(source);
}

function axisRemove(axis: Axis, coord: number, source: string): void {
  const key = quantize(coord);
  const set = axis.map.get(key);
  if (!set) return;
  set.delete(source);
  if (set.size === 0) {
    axis.map.delete(key);
    const at = axis.keys.indexOf(key);
    if (at >= 0) axis.keys.splice(at, 1);
  }
}

function axisSorted(axis: Axis): number[] {
  if (axis.dirty) {
    axis.keys.sort((a, b) => a - b);
    axis.dirty = false;
  }
  return axis.keys;
}

/** Index of the first element >= value. */
function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function axisQuery(axis: Axis, value: number, tolerance: number, exclude?: ReadonlySet<string>): AlignmentHit[] {
  const sorted = axisSorted(axis);
  const hits: AlignmentHit[] = [];
  let i = lowerBound(sorted, value - tolerance);
  for (; i < sorted.length && sorted[i] <= value + tolerance; i += 1) {
    const coord = sorted[i];
    const set = axis.map.get(coord);
    if (!set) continue;
    const sources = exclude ? [...set].filter((s) => !exclude.has(s)) : [...set];
    if (sources.length === 0) continue;
    hits.push({ coord, sources, delta: coord - value });
  }
  hits.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  return hits;
}

export interface AlignmentContribution {
  xs: number[];
  ys: number[];
}

/**
 * Global index of the x and y coordinates every component contributes
 * (bounding-box edges, centre and port positions). Moving one node removes and
 * reinserts only that node's coordinates, so the set of highlightable rows and
 * columns stays correct without rescanning the document.
 */
export class AlignmentIndex {
  private x = newAxis();
  private y = newAxis();
  private sources = new Map<string, AlignmentContribution>();

  get size(): number {
    return this.sources.size;
  }

  /** Replace every coordinate contributed by `source`. */
  update(source: string, contribution: AlignmentContribution): void {
    const prev = this.sources.get(source);
    if (prev) {
      if (sameNumbers(prev.xs, contribution.xs) && sameNumbers(prev.ys, contribution.ys)) return;
      for (const v of prev.xs) axisRemove(this.x, v, source);
      for (const v of prev.ys) axisRemove(this.y, v, source);
    }
    const xs = dedupe(contribution.xs);
    const ys = dedupe(contribution.ys);
    for (const v of xs) axisAdd(this.x, v, source);
    for (const v of ys) axisAdd(this.y, v, source);
    this.sources.set(source, { xs, ys });
  }

  /** Convenience: contribute a rect's edges and centre. */
  updateRect(source: string, r: Rect, extra?: { xs?: number[]; ys?: number[] }): void {
    this.update(source, {
      xs: [r.x, r.x + r.w / 2, r.x + r.w, ...(extra?.xs ?? [])],
      ys: [r.y, r.y + r.h / 2, r.y + r.h, ...(extra?.ys ?? [])],
    });
  }

  remove(source: string): void {
    const prev = this.sources.get(source);
    if (!prev) return;
    for (const v of prev.xs) axisRemove(this.x, v, source);
    for (const v of prev.ys) axisRemove(this.y, v, source);
    this.sources.delete(source);
  }

  clear(): void {
    this.x = newAxis();
    this.y = newAxis();
    this.sources.clear();
  }

  queryX(value: number, tolerance: number, exclude?: ReadonlySet<string>): AlignmentHit[] {
    return axisQuery(this.x, value, tolerance, exclude);
  }

  queryY(value: number, tolerance: number, exclude?: ReadonlySet<string>): AlignmentHit[] {
    return axisQuery(this.y, value, tolerance, exclude);
  }

  nearestX(value: number, tolerance: number, exclude?: ReadonlySet<string>): AlignmentHit | null {
    return this.queryX(value, tolerance, exclude)[0] ?? null;
  }

  nearestY(value: number, tolerance: number, exclude?: ReadonlySet<string>): AlignmentHit | null {
    return this.queryY(value, tolerance, exclude)[0] ?? null;
  }

  /** All indexed columns within a world-space span, for overlay rendering. */
  columnsIn(from: number, to: number): number[] {
    const sorted = axisSorted(this.x);
    const out: number[] = [];
    for (let i = lowerBound(sorted, from); i < sorted.length && sorted[i] <= to; i += 1) out.push(sorted[i]);
    return out;
  }

  rowsIn(from: number, to: number): number[] {
    const sorted = axisSorted(this.y);
    const out: number[] = [];
    for (let i = lowerBound(sorted, from); i < sorted.length && sorted[i] <= to; i += 1) out.push(sorted[i]);
    return out;
  }
}

function dedupe(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const q = quantize(v);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (quantize(a[i]) !== quantize(b[i])) return false;
  return true;
}

/**
 * Uniform spatial hash used for hit-testing, marquee selection, connector
 * obstacle queries and as the dependency-key source for spatial script reads.
 */
export class SpatialHash {
  private cell: number;
  private buckets = new Map<string, Set<string>>();
  private entries = new Map<string, { rect: Rect; keys: string[] }>();

  constructor(cellSize = 100) {
    this.cell = Math.max(1, cellSize);
  }

  get cellSize(): number {
    return this.cell;
  }

  setCellSize(size: number): void {
    const next = Math.max(1, size);
    if (next === this.cell) return;
    const snapshot = [...this.entries.entries()].map(([id, e]) => [id, e.rect] as const);
    this.cell = next;
    this.buckets.clear();
    this.entries.clear();
    for (const [id, r] of snapshot) this.update(id, r);
  }

  /** Bucket keys covering a rect; these double as script dependency keys. */
  keysFor(r: Rect): string[] {
    const x0 = Math.floor(r.x / this.cell);
    const y0 = Math.floor(r.y / this.cell);
    const x1 = Math.floor((r.x + r.w) / this.cell);
    const y1 = Math.floor((r.y + r.h) / this.cell);
    const keys: string[] = [];
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) keys.push(`${x},${y}`);
    return keys;
  }

  update(id: string, r: Rect): void {
    const prev = this.entries.get(id);
    const keys = this.keysFor(r);
    if (prev) {
      for (const key of prev.keys) {
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        bucket.delete(id);
        if (bucket.size === 0) this.buckets.delete(key);
      }
    }
    for (const key of keys) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = new Set();
        this.buckets.set(key, bucket);
      }
      bucket.add(id);
    }
    this.entries.set(id, { rect: r, keys });
  }

  remove(id: string): void {
    const prev = this.entries.get(id);
    if (!prev) return;
    for (const key of prev.keys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.buckets.delete(key);
    }
    this.entries.delete(id);
  }

  clear(): void {
    this.buckets.clear();
    this.entries.clear();
  }

  rectOf(id: string): Rect | null {
    return this.entries.get(id)?.rect ?? null;
  }

  /** Candidate ids whose buckets overlap `r`. Callers refine with exact tests. */
  query(r: Rect): string[] {
    const out = new Set<string>();
    for (const key of this.keysFor(r)) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      for (const id of bucket) out.add(id);
    }
    return [...out];
  }
}
