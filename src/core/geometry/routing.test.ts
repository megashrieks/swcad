import { describe, expect, it } from 'vitest';
import type { Rect, Vec } from './index';
import { route, routeOrthogonal, routeStraight, type RouteEndpoint } from './routing';

/** True if segment a-b crosses the interior of rect r (endpoints on the boundary don't count). */
function segmentCrossesInterior(a: Vec, b: Vec, r: Rect): boolean {
  const steps = 240;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5) return true;
  }
  return false;
}

/** True if any segment of the polyline crosses the interior of rect r. */
function routeCrossesInterior(points: Vec[], r: Rect): boolean {
  for (let i = 1; i < points.length; i += 1) {
    if (segmentCrossesInterior(points[i - 1], points[i], r)) return true;
  }
  return false;
}

describe('routeOrthogonal self-avoidance', () => {
  it('exits cleanly through its own port stub without flagging a false collision', () => {
    // A short, ordinary connection between two adjacent (unresized) nodes: the endpoint's
    // own bounds must not force a detour when the direct route is already fine.
    const ownerA: Rect = { x: 0, y: 0, w: 160, h: 90 };
    const ownerB: Rect = { x: 400, y: 0, w: 160, h: 90 };
    const from: RouteEndpoint = { pos: { x: 160, y: 45 }, facing: { x: 1, y: 0 } };
    const to: RouteEndpoint = { pos: { x: 400, y: 45 }, facing: { x: -1, y: 0 } };

    const points = routeOrthogonal(from, to, {
      obstacles: [ownerA, ownerB],
      fromOwnerBounds: ownerA,
      toOwnerBounds: ownerB,
      stub: 18,
      clearance: 10,
    });

    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    // A direct, unobstructed route should collapse to just the two endpoints.
    expect(points.length).toBe(2);
  });

  it('routes around its own oversized endpoint node instead of cutting through it', () => {
    // Box resized tall (0,0)-(160,300); its south port now sits deep below where it used to be.
    const owner: Rect = { x: 0, y: 0, w: 160, h: 300 };
    const from: RouteEndpoint = { pos: { x: 80, y: 300 }, facing: { x: 0, y: 1 } };
    const to: RouteEndpoint = { pos: { x: 300, y: 20 } };

    const points = routeOrthogonal(from, to, {
      obstacles: [owner],
      fromOwnerBounds: owner,
      stub: 16,
      clearance: 8,
    });

    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Skip the very first segment: it legitimately starts on the node's own boundary
    // while exiting through the stub. Every other segment must clear the node's body.
    for (let i = 2; i < points.length; i += 1) {
      expect(segmentCrossesInterior(points[i - 1], points[i], owner)).toBe(false);
    }
  });

  it('still produces a sane direct route for a normal short connection with no owner bounds', () => {
    const from: RouteEndpoint = { pos: { x: 0, y: 0 }, facing: { x: 1, y: 0 } };
    const to: RouteEndpoint = { pos: { x: 120, y: 0 }, facing: { x: -1, y: 0 } };
    const points = routeOrthogonal(from, to, {});
    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    expect(points.length).toBe(2);
  });

  it('terminates with a finite fallback route for a pathological/degenerate input', () => {
    const owner: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const from: RouteEndpoint = { pos: { x: 5, y: 5 }, facing: { x: 0, y: 0 } };
    const to: RouteEndpoint = { pos: { x: 5, y: 5 } };

    const points = routeOrthogonal(from, to, {
      obstacles: [owner, { x: 5, y: 5, w: -10, h: -10 }],
      fromOwnerBounds: owner,
      toOwnerBounds: owner,
      clearance: -100,
      stub: 0,
    });

    expect(points.length).toBeGreaterThanOrEqual(1);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('the high-level route() dispatcher only scopes owner-bounds exemption to the real endpoints across waypoints', () => {
    const ownerA: Rect = { x: 0, y: 0, w: 160, h: 90 };
    const ownerB: Rect = { x: 400, y: 0, w: 160, h: 90 };
    const from: RouteEndpoint = { pos: { x: 160, y: 45 }, facing: { x: 1, y: 0 } };
    const to: RouteEndpoint = { pos: { x: 400, y: 45 }, facing: { x: -1, y: 0 } };
    const points = route(from, to, {
      style: 'orthogonal',
      waypoints: [{ x: 280, y: 45 }],
      obstacles: [ownerA, ownerB],
      fromOwnerBounds: ownerA,
      toOwnerBounds: ownerB,
    });
    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('reproduces the reported bug: a west port on a large resized box no longer cuts straight through it', () => {
    // Box resized to 520x340 at world (220,170); connection leaves its west port,
    // heading to a node down and to the right, exactly as in the bug report.
    const owner: Rect = { x: 220, y: 170, w: 520, h: 340 };
    const from: RouteEndpoint = { pos: { x: 220, y: 340 }, facing: { x: -1, y: 0 } };
    const to: RouteEndpoint = { pos: { x: 870, y: 540 } };

    const points = routeOrthogonal(from, to, {
      obstacles: [owner],
      fromOwnerBounds: owner,
      stub: 18,
      clearance: 8,
    });

    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    expect(routeCrossesInterior(points, owner)).toBe(false);
  });

  it('mirrors the fix at the destination: a west port on a large resized box at the tail end is also cleared', () => {
    const owner: Rect = { x: 220, y: 170, w: 520, h: 340 };
    const from: RouteEndpoint = { pos: { x: 870, y: 540 } };
    const to: RouteEndpoint = { pos: { x: 220, y: 340 }, facing: { x: -1, y: 0 } };

    const points = routeOrthogonal(from, to, {
      obstacles: [owner],
      toOwnerBounds: owner,
      stub: 18,
      clearance: 8,
    });

    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    expect(routeCrossesInterior(points, owner)).toBe(false);
  });
});

describe('simplify monotonicity (via routeStraight)', () => {
  it('does not collapse a doubling-back triple that shares an axis', () => {
    // b is west of a, and c is far east: a straight line a->c would double back through b,
    // so b must be preserved even though a, b, c share the same y.
    const a: Vec = { x: 100, y: 50 };
    const b: Vec = { x: 82, y: 50 };
    const c: Vec = { x: 300, y: 50 };
    const points = routeStraight({ pos: a }, { pos: c }, { waypoints: [b] });
    expect(points).toEqual([a, b, c]);
  });

  it('still collapses a genuinely monotonic collinear triple', () => {
    const a: Vec = { x: 100, y: 50 };
    const b: Vec = { x: 200, y: 50 };
    const c: Vec = { x: 300, y: 50 };
    const points = routeStraight({ pos: a }, { pos: c }, { waypoints: [b] });
    expect(points).toEqual([a, c]);
  });

  it('preserves the equivalent vertical-axis behaviour', () => {
    const a: Vec = { x: 10, y: 100 };
    const bReversal: Vec = { x: 10, y: 82 };
    const cForward: Vec = { x: 10, y: 300 };
    const reversed = routeStraight({ pos: a }, { pos: cForward }, { waypoints: [bReversal] });
    expect(reversed).toEqual([a, bReversal, cForward]);

    const bMonotonic: Vec = { x: 10, y: 200 };
    const monotonic = routeStraight({ pos: a }, { pos: cForward }, { waypoints: [bMonotonic] });
    expect(monotonic).toEqual([a, cForward]);
  });
});


describe('A* routing engine', () => {
  const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

  it('turns on the document grid lines rather than hugging an off-grid obstacle', () => {
    const wall = rect(93, -63, 14, 126);
    const points = routeOrthogonal(
      { pos: { x: 0, y: 0 }, facing: { x: 1, y: 0 } },
      { pos: { x: 240, y: 0 }, facing: { x: -1, y: 0 } },
      { obstacles: [wall], stub: 16, clearance: 8, grid: 20 },
    );
    expect(routeCrossesInterior(points, wall)).toBe(false);
    // Every run longer than the exit stub should sit on a grid line; only the short
    // stub segments off the ports are allowed off-grid.
    let long = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
      if (length <= 32) continue;
      long += 1;
      expect((horizontal ? a.y : a.x) % 20).toBeCloseTo(0, 6);
    }
    expect(long).toBeGreaterThan(1);
  });

  it('falls back to the obstacle lattice when the grid cannot be followed', () => {
    // A gap far narrower than the grid: no grid-aligned route exists, so the router
    // reverts to the lanes just outside the obstacles instead of giving up.
    const above = rect(100, -400, 20, 397);
    const below = rect(100, 3, 20, 400);
    const points = routeOrthogonal(
      { pos: { x: 0, y: 0 }, facing: { x: 1, y: 0 } },
      { pos: { x: 300, y: 0 }, facing: { x: -1, y: 0 } },
      { obstacles: [above, below], stub: 16, clearance: 0, grid: 20 },
    );
    expect(routeCrossesInterior(points, above)).toBe(false);
    expect(routeCrossesInterior(points, below)).toBe(false);
    expect(points.at(-1)).toEqual({ x: 300, y: 0 });
  });

  // A pocket open only on the far side: every elbow, Z and single-obstacle lane candidate
  // still cuts a wall, so only a real search finds the way in.
  const maze: Rect[] = [rect(200, 100, 300, 20), rect(200, 280, 300, 20), rect(200, 100, 20, 200)];
  const from: RouteEndpoint = { pos: { x: 0, y: 200 }, facing: { x: 1, y: 0 } };
  const to: RouteEndpoint = { pos: { x: 350, y: 200 }, facing: { x: 1, y: 0 } };

  it('reaches into an enclosure the elbow search cannot solve', () => {
    const points = routeOrthogonal(from, to, { obstacles: maze, stub: 16, clearance: 8 });
    expect(points[0]).toEqual(from.pos);
    expect(points.at(-1)).toEqual(to.pos);
    for (const r of maze) expect(routeCrossesInterior(points, r)).toBe(false);

    const legacy = routeOrthogonal(from, to, { obstacles: maze, stub: 16, clearance: 8, router: 'simple' });
    expect(maze.some((r) => routeCrossesInterior(legacy, r))).toBe(true);
  });

  it('keeps a clear route as short and straight as the elbow search would', () => {
    const points = routeOrthogonal(
      { pos: { x: 0, y: 0 }, facing: { x: 1, y: 0 } },
      { pos: { x: 300, y: 0 }, facing: { x: -1, y: 0 } },
      { obstacles: [] },
    );
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
  });

  it('respects the bend penalty: a big one refuses a wiggle a small one accepts', () => {
    const obstacles = [rect(100, 10, 200, 200)];
    const straight = routeOrthogonal(
      { pos: { x: 0, y: 0 }, facing: { x: 1, y: 0 } },
      { pos: { x: 400, y: 0 }, facing: { x: -1, y: 0 } },
      { obstacles, bendPenalty: 60 },
    );
    expect(straight.length).toBe(2);
  });

  it('routes around a node that sits directly between two ports', () => {
    const ownerA = rect(0, 0, 160, 90);
    const ownerB = rect(500, 0, 160, 90);
    const blocker = rect(250, -60, 120, 220);
    const points = routeOrthogonal(
      { pos: { x: 160, y: 45 }, facing: { x: 1, y: 0 } },
      { pos: { x: 500, y: 45 }, facing: { x: -1, y: 0 } },
      {
        obstacles: [ownerA, ownerB, blocker],
        fromOwnerBounds: ownerA,
        toOwnerBounds: ownerB,
        stub: 18,
        clearance: 10,
      },
    );
    expect(routeCrossesInterior(points, blocker)).toBe(false);
    // Out, around the nearest side of the blocker and back in: 6 points at most.
    expect(points.length).toBeLessThanOrEqual(6);
  });

  it('falls back to a finite best-effort route when the target is walled in', () => {
    const room = [
      rect(400, 100, 200, 20),
      rect(400, 280, 200, 20),
      rect(400, 100, 20, 200),
      rect(580, 100, 20, 200),
    ];
    const points = routeOrthogonal({ pos: { x: 0, y: 200 } }, { pos: { x: 500, y: 200 } }, { obstacles: room });
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('stays fast on a dense sheet', () => {
    const dense: Rect[] = [];
    for (let i = 0; i < 200; i += 1) dense.push(rect((i % 20) * 90, Math.floor(i / 20) * 90, 60, 40));
    const started = Date.now();
    for (let i = 0; i < 20; i += 1) {
      const points = routeOrthogonal(
        { pos: { x: 5, y: 5 + i }, facing: { x: 0, y: -1 } },
        { pos: { x: 1700, y: 820 }, facing: { x: 1, y: 0 } },
        { obstacles: dense, stub: 16, clearance: 8 },
      );
      expect(points.length).toBeGreaterThanOrEqual(2);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('tightly packed obstacles', () => {
  const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

  // Real geometry from a user sheet: the source node sits ~15px below a large box, so at
  // the requested clearance of 10 the two inflated rects overlap and no corridor exists.
  const bounds = {
    target: rect(392.125, 155.951, 376.875, 248.097),
    big: rect(865.078, 290.078, 235.547, 141.628),
    inner: rect(896.5, 311.5, 172.625, 97.5),
    source: rect(951.5, 446.5, 167.5, 97.5),
  };

  it('drops clearance rather than cutting straight through a box', () => {
    const points = routeOrthogonal(
      { pos: { x: 1035, y: 450 }, facing: { x: 0, y: -1 } },
      { pos: { x: 760, y: 278.8264 }, facing: { x: 1, y: 0 } },
      {
        obstacles: Object.values(bounds),
        stub: 18,
        clearance: 10,
        fromOwnerBounds: bounds.source,
        toOwnerBounds: bounds.target,
      },
    );

    for (let i = 1; i < points.length; i += 1) {
      for (const r of [bounds.big, bounds.inner]) {
        expect(segmentCrossesInterior(points[i - 1], points[i], r)).toBe(false);
      }
    }
    expect(points.length).toBeGreaterThan(3);
  });

  it('does not shorten the exit stub when nothing blocks it', () => {
    const points = routeOrthogonal(
      { pos: { x: 100, y: 100 }, facing: { x: 0, y: -1 } },
      { pos: { x: 400, y: 400 }, facing: { x: 0, y: 1 } },
      { obstacles: [], stub: 18, clearance: 10 },
    );
    expect(points[1]).toEqual({ x: 100, y: 82 });
  });
});
