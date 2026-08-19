import { describe, expect, it } from 'vitest';
import { outlineAttach, outlineBounds, outlineCenter, outlineDistance, outlinePath, type Outline } from './outline';

const circle: Outline = { kind: 'ellipse', c: { x: 100, y: 100 }, rx: 50, ry: 50, rot: 0 };
const square: Outline = {
  kind: 'polygon',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  closed: true,
};

describe('outlineCenter / outlineBounds', () => {
  it('centres an ellipse on its own centre', () => {
    expect(outlineCenter(circle)).toEqual({ x: 100, y: 100 });
    expect(outlineBounds(circle)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });

  it('centres a polygon on its bounding box', () => {
    expect(outlineCenter(square)).toEqual({ x: 50, y: 50 });
  });

  it('grows the box of a rotated ellipse only along its long axis', () => {
    const box = outlineBounds({ kind: 'ellipse', c: { x: 0, y: 0 }, rx: 40, ry: 10, rot: 90 });
    expect(box.w).toBeCloseTo(20, 6);
    expect(box.h).toBeCloseTo(80, 6);
  });
});

describe('outlineAttach', () => {
  it('lands on the circumference facing the target', () => {
    const hit = outlineAttach(circle, { x: 400, y: 100 });
    expect(hit.pos.x).toBeCloseTo(150, 6);
    expect(hit.pos.y).toBeCloseTo(100, 6);
    expect(hit.facing.x).toBeCloseTo(1, 6);
    expect(hit.facing.y).toBeCloseTo(0, 6);
  });

  it('follows the target around the circle', () => {
    const hit = outlineAttach(circle, { x: 100, y: -200 });
    expect(hit.pos.x).toBeCloseTo(100, 6);
    expect(hit.pos.y).toBeCloseTo(50, 6);
    expect(hit.facing.y).toBeCloseTo(-1, 6);
  });

  it('lands on a diagonal at 45 degrees', () => {
    const hit = outlineAttach(circle, { x: 300, y: 300 });
    expect(hit.pos.x).toBeCloseTo(100 + 50 / Math.SQRT2, 6);
    expect(hit.pos.y).toBeCloseTo(100 + 50 / Math.SQRT2, 6);
  });

  it('respects an ellipse rotation', () => {
    const spun: Outline = { kind: 'ellipse', c: { x: 0, y: 0 }, rx: 40, ry: 10, rot: 90 };
    const hit = outlineAttach(spun, { x: 0, y: 500 });
    expect(hit.pos.x).toBeCloseTo(0, 6);
    expect(hit.pos.y).toBeCloseTo(40, 6);
  });

  it('lands on the side of a rectangle with the outward normal', () => {
    const hit = outlineAttach(square, { x: 500, y: 50 });
    expect(hit.pos).toEqual({ x: 100, y: 50 });
    expect(hit.facing.x).toBeCloseTo(1, 6);
    expect(hit.facing.y).toBeCloseTo(0, 6);
  });

  it('lands on the corner of a rectangle when aimed diagonally', () => {
    const hit = outlineAttach(square, { x: 200, y: 200 });
    expect(hit.pos.x).toBeCloseTo(100, 6);
    expect(hit.pos.y).toBeCloseTo(100, 6);
  });

  it('falls back to the centre for a degenerate direction', () => {
    expect(outlineAttach(circle, { x: 100, y: 100 }).pos).toEqual({ x: 100, y: 100 });
  });

  it('leaves an open polyline through its own segment', () => {
    const line: Outline = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false };
    const hit = outlineAttach(line, { x: 50, y: -100 });
    expect(hit.pos.y).toBeCloseTo(0, 6);
    expect(Math.abs(hit.facing.y)).toBeCloseTo(1, 6);
  });

  it('meets an open stroke at its nearest point, not at its midpoint', () => {
    const rail: Outline = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], closed: false };
    const hit = outlineAttach(rail, { x: -80, y: 75 });
    expect(hit.pos.x).toBeCloseTo(0, 6);
    expect(hit.pos.y).toBeCloseTo(75, 6);
    expect(hit.facing.x).toBeCloseTo(-1, 6);
  });

  it('clamps to the end of an open stroke rather than running off it', () => {
    const rail: Outline = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], closed: false };
    expect(outlineAttach(rail, { x: 20, y: 400 }).pos).toEqual({ x: 0, y: 100 });
  });

  it('lands on an arc that bulges away from its own bounding-box centre', () => {
    // A half-arc rotated 180° - the db-test cap - curves away from the centre in every
    // direction, so a ray from that centre used to miss and strand the connector there.
    const arc = openArc(true);
    for (const from of [{ x: 51, y: -200 }, { x: 51, y: 400 }, { x: -200, y: 155 }, { x: 300, y: 155 }]) {
      const hit = outlineAttach(arc, from);
      expect(onStroke(arc, hit.pos), `from ${from.x},${from.y}`).toBe(true);
    }
  });

  it('lands on an unrotated arc from every direction too', () => {
    const arc = openArc(false);
    for (const from of [{ x: 51, y: -200 }, { x: 51, y: 400 }, { x: -200, y: 155 }, { x: 300, y: 155 }]) {
      const hit = outlineAttach(arc, from);
      expect(onStroke(arc, hit.pos), `from ${from.x},${from.y}`).toBe(true);
    }
  });

  it('still crosses a closed outline that hides its own centre', () => {
    // Concave "C": the centre sits in the notch, outside the shape.
    const c: Outline = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 80 },
        { x: 100, y: 80 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      closed: true,
    };
    const hit = outlineAttach(c, { x: 300, y: 50 });
    expect(outlineDistance(c, hit.pos)).toBeCloseTo(0, 6);
  });
});

/** Half of an ellipse, as `elementOutline` samples it; `flipped` mirrors it about its chord. */
function openArc(flipped: boolean): Outline {
  const points = [];
  for (let i = 0; i <= 32; i += 1) {
    const a = Math.PI + (i / 32) * Math.PI;
    const p = { x: 51 + Math.cos(a) * 50, y: 145 + Math.sin(a) * 25 };
    points.push(flipped ? { x: 102 - p.x, y: 290 - p.y } : p);
  }
  return { kind: 'polygon', points, closed: false };
}

const onStroke = (o: Outline, p: { x: number; y: number }): boolean => outlineDistance(o, p) < 1e-6;

describe('outlineDistance', () => {
  it('measures to the stroke, not to the filled area', () => {
    expect(outlineDistance(circle, { x: 100, y: 100 })).toBeCloseTo(50, 6);
    expect(outlineDistance(circle, { x: 155, y: 100 })).toBeCloseTo(5, 6);
    expect(outlineDistance(circle, { x: 150, y: 100 })).toBeCloseTo(0, 6);
  });

  it('measures to the nearest edge of a rectangle', () => {
    expect(outlineDistance(square, { x: 50, y: 50 })).toBeCloseTo(50, 6);
    expect(outlineDistance(square, { x: 104, y: 40 })).toBeCloseTo(4, 6);
  });

  it('approximates a squashed ellipse closely enough to hit-test', () => {
    const oval: Outline = { kind: 'ellipse', c: { x: 0, y: 0 }, rx: 100, ry: 40, rot: 0 };
    expect(outlineDistance(oval, { x: 100, y: 0 })).toBeLessThan(0.5);
    expect(outlineDistance(oval, { x: 0, y: 45 })).toBeCloseTo(5, 1);
  });
});

describe('outlinePath', () => {
  it('traces an ellipse with two arcs', () => {
    const d = outlinePath(circle);
    expect(d.startsWith('M 50 100')).toBe(true);
    expect(d.match(/A /g)?.length).toBe(2);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('closes a polygon and leaves a polyline open', () => {
    expect(outlinePath(square)).toBe('M 0 0 L 100 0 L 100 100 L 0 100 Z');
    expect(outlinePath({ ...square, closed: false }).endsWith('Z')).toBe(false);
  });
});
