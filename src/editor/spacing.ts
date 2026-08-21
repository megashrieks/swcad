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
  /** `active` is a gap the moving item makes; `reference` is the gap it is copying. */
  role: 'active' | 'reference';
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
const middle = (r: Rect, axis: Axis): number => near(r, axis) + extent(r, axis) / 2;

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
  /** Gaps between neighbouring peers, which the box's own gaps can copy. */
  references: Gap[];
}

/**
 * What the box's row (or column) looks like: who it sits between, and every gap already
 * in that row that it could copy.
 */
function survey(box: Rect, peers: readonly Rect[], axis: Axis, minGap: number): Neighbourhood {
  const band = peers
    .filter((p) => shared(box, p, axis) !== null)
    .sort((a, b) => near(a, axis) - near(b, axis));

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
  for (let i = 0; i + 1 < band.length; i += 1) {
    const gap = gapOf(band[i], band[i + 1]);
    // A gap the box is standing in is the space it occupies, not a rhythm to copy: its two
    // halves are the interesting measurements, and they are `gapBefore` and `gapAfter`.
    // Touching counts as standing in it, otherwise a peer sitting exactly where the box is
    // would offer the box its own gap back and the same bracket would be drawn twice.
    if (gap && !(gap.to >= near(box, axis) && gap.from <= far(box, axis))) references.push(gap);
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

const bracket = (axis: Axis, gap: Gap, role: Measure['role']): Measure => ({
  axis,
  from: gap.from,
  to: gap.to,
  at: gap.at,
  distance: gap.size,
  role,
});

/** The reference nearest the box, among those the gap matches. */
function copyOf(box: Rect, gap: Gap | null, references: readonly Gap[], axis: Axis, epsilon: number): Gap | null {
  if (!gap) return null;
  let best: Gap | null = null;
  let bestReach = Infinity;
  for (const ref of references) {
    if (Math.abs(ref.size - gap.size) > epsilon) continue;
    const reach = Math.abs(ref.at - middle(box, axis)) + Math.abs((ref.from + ref.to) / 2 - middle(box, axis));
    if (reach < bestReach) {
      best = ref;
      bestReach = reach;
    }
  }
  return best;
}

/**
 * The brackets to draw for a box at its final position: at most one pair per axis, since
 * the point is to show a match rather than to dimension the whole sheet.
 */
export function spacingMeasures(box: Rect, peers: readonly Rect[], opt: SpacingOptions): Measure[] {
  const out: Measure[] = [];
  for (const axis of ['x', 'y'] as const) {
    const row = survey(box, peers, axis, opt.minGap);
    const { gapBefore, gapAfter } = row;

    // Evenly spaced between two neighbours: both gaps are the box's own, and each is the
    // other's reference, so both get the strong bracket.
    if (gapBefore && gapAfter && Math.abs(gapBefore.size - gapAfter.size) <= opt.epsilon) {
      out.push(bracket(axis, gapBefore, 'active'), bracket(axis, gapAfter, 'active'));
      continue;
    }

    const beforeCopy = copyOf(box, gapBefore, row.references, axis, opt.epsilon);
    if (gapBefore && beforeCopy) {
      out.push(bracket(axis, gapBefore, 'active'), bracket(axis, beforeCopy, 'reference'));
      continue;
    }
    const afterCopy = copyOf(box, gapAfter, row.references, axis, opt.epsilon);
    if (gapAfter && afterCopy) {
      out.push(bracket(axis, gapAfter, 'active'), bracket(axis, afterCopy, 'reference'));
    }
  }
  return out;
}
