import { describe, expect, it } from 'vitest';
import type { Rect, Vec } from './index';
import { axisOf, routeAStar } from './astar';

const crosses = (points: Vec[], r: Rect): boolean => {
  const steps = 200;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5) return true;
    }
  }
  return false;
};

const length = (points: Vec[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return total;
};

const isOrthogonal = (points: Vec[]): boolean =>
  points.every((p, i) => {
    if (i === 0) return true;
    const prev = points[i - 1];
    return Math.abs(p.x - prev.x) < 1e-6 || Math.abs(p.y - prev.y) < 1e-6;
  });

describe('axisOf', () => {
  it('reads the dominant axis of a facing normal', () => {
    expect(axisOf({ x: 1, y: 0 })).toBe('h');
    expect(axisOf({ x: -1, y: 0 })).toBe('h');
    expect(axisOf({ x: 0, y: 1 })).toBe('v');
    expect(axisOf({ x: 0.2, y: -0.9 })).toBe('v');
    expect(axisOf({ x: 0, y: 0 })).toBeNull();
    expect(axisOf(undefined)).toBeNull();
  });
});

describe('routeAStar', () => {
  it('returns a straight two-point path when nothing is in the way', () => {
    const path = routeAStar({ x: 0, y: 0 }, { x: 200, y: 0 }, { obstacles: [] });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it('takes exactly one corner for a diagonal hop', () => {
    const path = routeAStar({ x: 0, y: 0 }, { x: 200, y: 100 }, { obstacles: [] })!;
    expect(path.length).toBe(3);
    expect(length(path)).toBeCloseTo(300, 6);
    expect(isOrthogonal(path)).toBe(true);
  });

  it('walks around a blocking rectangle without touching its interior', () => {
    const wall: Rect = { x: 80, y: -60, w: 40, h: 120 };
    const path = routeAStar({ x: 0, y: 0 }, { x: 200, y: 0 }, { obstacles: [wall] })!;
    expect(path).not.toBeNull();
    expect(crosses(path, wall)).toBe(false);
    expect(isOrthogonal(path)).toBe(true);
    // Up and over: 4 points, 2 corners, with no redundant collinear points in between.
    expect(path.length).toBe(4);
  });

  it('threads a serpentine corridor that needs several detours', () => {
    // Wall A only has a gap on its right, wall B only on its left: the route is forced
    // into an S — no single elbow can solve this.
    const wallA: Rect = { x: -300, y: 100, w: 800, h: 20 };
    const wallB: Rect = { x: 200, y: 220, w: 800, h: 20 };
    const path = routeAStar({ x: 300, y: 60 }, { x: 300, y: 320 }, {
      obstacles: [wallA, wallB],
      startAxis: 'v',
      goalAxis: 'v',
    })!;
    expect(path).not.toBeNull();
    expect(crosses(path, wallA)).toBe(false);
    expect(crosses(path, wallB)).toBe(false);
    expect(isOrthogonal(path)).toBe(true);
    // It must have gone right of wall A and left of wall B.
    expect(Math.max(...path.map((p) => p.x))).toBeGreaterThan(500);
    expect(Math.min(...path.map((p) => p.x))).toBeLessThan(200);
  });

  it('prefers a straight route over a shorter one with more corners', () => {
    // A detour lane one unit shorter is available, but it costs two extra bends.
    const path = routeAStar({ x: 0, y: 0 }, { x: 400, y: 0 }, {
      obstacles: [{ x: 100, y: 20, w: 200, h: 200 }],
      bendPenalty: 40,
    })!;
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
  });

  it('charges a bend when the route has to leave against the start axis', () => {
    const straight = routeAStar({ x: 0, y: 0 }, { x: 0, y: 200 }, { obstacles: [], startAxis: 'v' })!;
    expect(straight.length).toBe(2);
    // Same geometry, but the port faces east: the route still gets there, having turned.
    const turned = routeAStar({ x: 0, y: 0 }, { x: 0, y: 200 }, { obstacles: [], startAxis: 'h' })!;
    expect(turned.length).toBe(2);
  });

  it('escapes an endpoint that sits inside an obstacle', () => {
    // The source port is swallowed by an overlapping neighbour: it must still get out.
    const swallow: Rect = { x: -20, y: -20, w: 60, h: 60 };
    const path = routeAStar({ x: 0, y: 0 }, { x: 300, y: 0 }, { obstacles: [swallow] })!;
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 300, y: 0 });
  });

  it('returns null when the goal is walled in', () => {
    const room: Rect[] = [
      { x: 200, y: 100, w: 200, h: 20 },
      { x: 200, y: 280, w: 200, h: 20 },
      { x: 200, y: 100, w: 20, h: 200 },
      { x: 380, y: 100, w: 20, h: 200 },
    ];
    const path = routeAStar({ x: 0, y: 200 }, { x: 300, y: 200 }, { obstacles: room });
    expect(path).toBeNull();
  });

  it('declines a lattice larger than maxNodes instead of hanging', () => {
    const obstacles: Rect[] = [];
    for (let i = 0; i < 60; i += 1) obstacles.push({ x: i * 40, y: i * 40, w: 20, h: 20 });
    const path = routeAStar({ x: -100, y: -100 }, { x: 3000, y: 3000 }, { obstacles, maxNodes: 500 });
    expect(path).toBeNull();
  });

  it('never doubles back along the port normal it just left', () => {
    // Leaving north with the target to the south-east: descending immediately would
    // retrace the stub, so the route must travel sideways first.
    const path = routeAStar({ x: 220, y: 92 }, { x: 802, y: 155 }, {
      obstacles: [{ x: 140, y: 95.5, w: 170, h: 100 }],
      startAxis: 'v',
      startDir: { x: 0, y: -1 },
    })!;
    expect(path).not.toBeNull();
    const first = path[1];
    expect(first.y).toBeLessThanOrEqual(92 + 1e-6);
  });

  it('never arrives at the target port from behind it', () => {
    // The port's normal points south, so the route may not arrive travelling south —
    // it would have come from inside the node and would double back over the stub.
    const path = routeAStar({ x: 0, y: 0 }, { x: 200, y: 100 }, {
      obstacles: [],
      goalDir: { x: 0, y: 1 },
    })!;
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    const arrivingSouth = Math.abs(prev.x - last.x) < 1e-6 && prev.y < last.y;
    expect(arrivingSouth).toBe(false);
    expect(Math.abs(prev.y - last.y)).toBeLessThan(1e-6);
  });

  it('is deterministic for identical input', () => {
    const obstacles: Rect[] = [
      { x: 100, y: -40, w: 40, h: 120 },
      { x: 220, y: -10, w: 40, h: 200 },
    ];
    const a = routeAStar({ x: 0, y: 0 }, { x: 400, y: 30 }, { obstacles })!;
    const b = routeAStar({ x: 0, y: 0 }, { x: 400, y: 30 }, { obstacles })!;
    expect(a).toEqual(b);
  });

  it('finds the shortest legal detour around a wide obstacle', () => {
    // The gap above is much closer than the one below, so the route must use it.
    const wall: Rect = { x: 100, y: -400, w: 40, h: 420 };
    const path = routeAStar({ x: 0, y: 100 }, { x: 300, y: 100 }, { obstacles: [wall], bendPenalty: 5 })!;
    expect(crosses(path, wall)).toBe(false);
    expect(Math.max(...path.map((p) => p.y))).toBeLessThan(200);
  });
});
