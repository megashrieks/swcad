/**
 * Equal-gap detection: the arithmetic behind the dimension brackets.
 *
 * Alignment guides answer "is this edge level with that one". They say nothing about
 * *rhythm*, which is what makes a row of boxes look deliberate: the gaps between them
 * being the same number. So while something is being placed or moved, the editor looks for
 * a gap it would make that matches a gap already on the sheet, pulls it onto that number,
 * and draws both gaps as a bracket — the one being made and the one it copies.
 *
 * Everything here is pure and axis-generic: `axis` names the direction the distance is
 * measured along, and "cross" is the other one. A horizontal gap is only interesting
 * between two things that share some vertical extent, which is what keeps a bracket
 * attached to a row rather than measuring across the whole sheet.
 */
import type { Rect } from '@core/geometry/index';

export type Axis = 'x' | 'y';

/** A dimension bracket: a distance along `axis`, drawn at `at` on the other axis. */
export interface Measure {
  axis: Axis;
  /** World coordinates of the two ends, along `axis`. `from` is always the lower one. */
  from: number;
  to: number;
  /** Where on the cross axis the bracket sits — the middle of the band both items share. */
  at: number;
  distance: number;
}

export interface SpacingOptions {
  /** How far off a matching gap the moving box may be and still be pulled onto it. */
  tolerance: number;
  /** How close two gaps must be to count as the same measurement. */
  epsilon: number;
  /** Thinner than this is two things touching, not a rhythm worth repeating. */
  minGap: number;
}

const near = (r: Rect, axis: Axis): number => (axis === 'x' ? r.x : r.y);
const extent = (r: Rect, axis: Axis): number => (axis === 'x' ? r.w : r.h);
const far = (r: Rect, axis: Axis): number => near(r, axis) + extent(r, axis);
const crossNear = (r: Rect, axis: Axis): number => (axis === 'x' ? r.y : r.x);
const crossFar = (r: Rect, axis: Axis): number => (axis === 'x' ? r.y + r.h : r.x + r.w);

/** Middle of the band two rects share across `axis`, or null when they share none. */
function shared(a: Rect, b: Rect, axis: Axis): number | null {
  const lo = Math.max(crossNear(a, axis), crossNear(b, axis));
  const hi = Math.min(crossFar(a, axis), crossFar(b, axis));
  return hi > lo ? (lo + hi) / 2 : null;
}

interface Gap {
  size: number;
  from: number;
  to: number;
  at: number;
}

interface Neighbourhood {
  /** Nearest peer wholly before / after the box along the axis. */
  before: Rect | null;
  after: Rect | null;
  gapBefore: Gap | null;
  gapAfter: Gap | null;
  /** Gaps between neighbouring peers anywhere in reach, which the box's own gaps can copy. */
  references: Gap[];
}

/**
 * What the box's row (or column) looks like: who it sits between, and every gap in reach
 * that it could copy.
 *
 * The box's own two gaps come from its row — the peers it shares a band with — but the
 * references do not. A rhythm is a rhythm wherever it is on the sheet, and while a grid is
 * being laid out the row being worked on is usually the one with nothing in it yet; the
 * gaps worth matching are in the rows already done. So every peer contributes the gap to
 * its own nearest neighbour, whichever row that is in, and the caller limits how far
 * "in reach" goes.
 */
function survey(box: Rect, peers: readonly Rect[], axis: Axis, minGap: number): Neighbourhood {
  const sorted = [...peers].sort((a, b) => near(a, axis) - near(b, axis));
  const band = sorted.filter((p) => shared(box, p, axis) !== null);

  const gapOf = (a: Rect, b: Rect): Gap | null => {
    const size = near(b, axis) - far(a, axis);
    const at = shared(a, b, axis);
    if (at === null || size < minGap) return null;
    return { size, from: far(a, axis), to: near(b, axis), at };
  };

  let before: Rect | null = null;
  let after: Rect | null = null;
  for (const p of band) {
    if (far(p, axis) <= near(box, axis)) {
      if (!before || far(p, axis) > far(before, axis)) before = p;
    } else if (near(p, axis) >= far(box, axis)) {
      if (!after || near(p, axis) < near(after, axis)) after = p;
    }
  }

  const references: Gap[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const q = sorted[j];
      // Sorted by their near edge, so the first peer clear of `p` that shares a band with
      // it is `p`'s neighbour; anything past that is measuring across whatever sits between.
      if (near(q, axis) < far(p, axis)) continue;
      if (shared(p, q, axis) === null) continue;
      const gap = gapOf(p, q);
      // A gap the box is standing in is the space it occupies, not a rhythm to copy: its two
      // halves are the interesting measurements, and they are `gapBefore` and `gapAfter`.
      // Touching counts as standing in it, otherwise a peer sitting exactly where the box is
      // would offer the box its own gap back and the same bracket would be drawn twice. It
      // has to be the box's own row though — a gap two rows up merely spans the same
      // columns, and dropping those is what used to leave a wide selection with nothing to
      // measure against.
      const straddled =
        gap !== null &&
        gap.to >= near(box, axis) &&
        gap.from <= far(box, axis) &&
        shared(box, p, axis) !== null &&
        shared(box, q, axis) !== null;
      if (gap && !straddled) references.push(gap);
      break;
    }
  }

  return {
    before,
    after,
    gapBefore: before ? gapOf(before, box) : null,
    gapAfter: after ? gapOf(box, after) : null,
    references,
  };
}

/**
 * How far to move the box along `axis` so one of its gaps repeats a gap already there,
 * or null when nothing within `tolerance` does.
 *
 * Sitting centred between two neighbours is the same rule applied to the box's own two
 * gaps — no third component needed — so it is offered as a candidate too.
 */
export function spacingShift(
  box: Rect,
  peers: readonly Rect[],
  axis: Axis,
  opt: SpacingOptions,
): number | null {
  const row = survey(box, peers, axis, opt.minGap);
  const { before, after } = row;
  if (!before && !after) return null;

  const targets: number[] = [];
  if (before && after) {
    const free = near(after, axis) - far(before, axis) - extent(box, axis);
    if (free >= 2 * opt.minGap) targets.push(far(before, axis) + free / 2);
  }
  for (const ref of row.references) {
    if (before) targets.push(far(before, axis) + ref.size);
    if (after) targets.push(near(after, axis) - ref.size - extent(box, axis));
  }

  let best: number | null = null;
  for (const target of targets) {
    const delta = target - near(box, axis);
    if (Math.abs(delta) > opt.tolerance) continue;
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best;
}

const bracket = (axis: Axis, gap: Gap): Measure => ({
  axis,
  from: gap.from,
  to: gap.to,
  at: gap.at,
  distance: gap.size,
});

/** Whether any gap already in the row repeats this one. */
function isCopied(gap: Gap, references: readonly Gap[], epsilon: number): boolean {
  return references.some((ref) => Math.abs(ref.size - gap.size) <= epsilon);
}

/**
 * The brackets to draw for a box at its final position: the gap or gaps the box itself
 * makes, and every gap in reach that measures the same.
 *
 * Only the nearest match used to be drawn, which answered "is this gap repeated" but not
 * the question actually being asked while a grid is laid out, which is "are they all the
 * same". A page of identical brackets says that at a glance.
 */
export function spacingMeasures(box: Rect, peers: readonly Rect[], opt: SpacingOptions): Measure[] {
  const out: Measure[] = [];
  for (const axis of ['x', 'y'] as const) {
    const row = survey(box, peers, axis, opt.minGap);
    const { gapBefore, gapAfter } = row;

    // Evenly spaced between two neighbours: both gaps are the box's own, and each is the
    // other's reference.
    const own: Gap[] =
      gapBefore && gapAfter && Math.abs(gapBefore.size - gapAfter.size) <= opt.epsilon
        ? [gapBefore, gapAfter]
        : gapBefore && isCopied(gapBefore, row.references, opt.epsilon)
          ? [gapBefore]
          : gapAfter && isCopied(gapAfter, row.references, opt.epsilon)
            ? [gapAfter]
            : [];
    if (own.length === 0) continue;

    const size = own[0].size;
    for (const gap of own) out.push(bracket(axis, gap));
    for (const ref of row.references) {
      if (Math.abs(ref.size - size) <= opt.epsilon) out.push(bracket(axis, ref));
    }
  }
  return out;
}
