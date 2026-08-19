import { describe, expect, it } from 'vitest';
import {
  elementBounds,
  elementOutline,
  elementPoint,
  parseSvg,
  scaleGeometry,
  scalePathData,
  serialize,
  type VNode,
} from './svg';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('scaleGeometry', () => {
  it('scales rect x/y/width/height anisotropically', () => {
    const nodes = parseSvg('<rect x="10" y="20" width="30" height="40" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs).toMatchObject({ x: '20', y: '60', width: '60', height: '120' });
  });

  it('scales circle center by axis and radius by min(sx, sy)', () => {
    const nodes = parseSvg('<circle cx="10" cy="20" r="5" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs.cx).toBe('20');
    expect(scaled.attrs.cy).toBe('60');
    // A circle radius can't scale anisotropically without becoming an ellipse, so we
    // conservatively pick the smaller factor rather than silently emitting an ellipse.
    expect(scaled.attrs.r).toBe('10');
  });

  it('scales ellipse rx/ry independently', () => {
    const nodes = parseSvg('<ellipse cx="10" cy="20" rx="4" ry="6" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs).toMatchObject({ cx: '20', cy: '60', rx: '8', ry: '18' });
  });

  it('scales line endpoints', () => {
    const nodes = parseSvg('<line x1="1" y1="2" x2="3" y2="4" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs).toMatchObject({ x1: '2', y1: '6', x2: '6', y2: '12' });
  });

  it('scales polyline and polygon points', () => {
    const polyline = parseSvg('<polyline points="1,2 3,4 5,6" />');
    const [scaledLine] = scaleGeometry(polyline, 2, 3);
    expect(scaledLine.attrs.points).toBe('2,6 6,12 10,18');

    const polygon = parseSvg('<polygon points="0 0, 10 0, 10 10" />');
    const [scaledPoly] = scaleGeometry(polygon, 2, 3);
    expect(scaledPoly.attrs.points).toBe('0,0 20,0 20,30');
  });

  it('scales text position and dx/dy but not font-size', () => {
    const nodes = parseSvg('<text x="10" y="20" dx="1" dy="2" font-size="12">hi</text>');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs).toMatchObject({ x: '20', y: '60', dx: '2', dy: '6' });
    expect(scaled.text).toBe('hi');
  });

  it('headline fix: stroke-width and font-size are never scaled, unlike the old CSS transform:scale approach', () => {
    const nodes = parseSvg('<rect x="0" y="0" width="10" height="10" stroke-width="2" /><text x="0" y="0" font-size="14">t</text>');
    const [rectScaled, textScaled] = scaleGeometry(nodes, 2, 5);
    expect(rectScaled.attrs['stroke-width']).toBe('2');
    expect(textScaled.attrs['font-size']).toBe('14');
  });

  it('leaves other presentation attributes untouched', () => {
    const nodes = parseSvg(
      '<rect stroke-dasharray="4 2" stroke-dashoffset="1" letter-spacing="1" word-spacing="1" opacity="0.5" fill="red" stroke="blue" marker-end="url(#a)" />',
    );
    const before = deepClone(nodes[0].attrs);
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs).toEqual(before);
  });

  it('scales a child translate() transform but leaves rotate() untouched', () => {
    const nodes = parseSvg('<g><rect transform="translate(10 20)" /><rect transform="rotate(45)" /></g>');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.children[0].attrs.transform).toBe('translate(20 60)');
    expect(scaled.children[1].attrs.transform).toBe('rotate(45)');
  });

  it('handles the one-argument translate(a) form with implicit b=0', () => {
    const nodes = parseSvg('<rect transform="translate(10)" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs.transform).toBe('translate(20 0)');
  });

  it('preserves non-numeric attribute values verbatim and never emits NaN', () => {
    const nodes = parseSvg('<rect x="calc(1px)" width="100%" y="" height="10" />');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.attrs.x).toBe('calc(1px)');
    expect(scaled.attrs.width).toBe('100%');
    expect(scaled.attrs.y).toBe('');
    expect(scaled.attrs.height).toBe('30');
    expect(serialize(scaled ? [scaled] : [])).not.toContain('NaN');
  });

  it('does not mutate the input tree', () => {
    const nodes = parseSvg('<g><rect x="1" y="2" width="3" height="4" stroke-width="2" /></g>');
    const before = deepClone(nodes);
    scaleGeometry(nodes, 2, 3);
    expect(nodes).toEqual(before);
  });

  it('returns the same array reference when sx === 1 && sy === 1', () => {
    const nodes = parseSvg('<rect x="1" y="2" width="3" height="4" />');
    expect(scaleGeometry(nodes, 1, 1)).toBe(nodes);
  });

  it('returns input unchanged for non-finite or zero scale factors', () => {
    const nodes = parseSvg('<rect x="1" y="2" width="3" height="4" />');
    expect(scaleGeometry(nodes, NaN, 2)).toBe(nodes);
    expect(scaleGeometry(nodes, Infinity, 2)).toBe(nodes);
    expect(scaleGeometry(nodes, 0, 2)).toBe(nodes);
    expect(scaleGeometry(nodes, 2, 0)).toBe(nodes);
  });

  it('scales path d via scalePathData and recurses into children', () => {
    const nodes = parseSvg('<g><path d="M0 0 L10 20" /></g>');
    const [scaled] = scaleGeometry(nodes, 2, 3);
    expect(scaled.children[0].attrs.d).toBe('M0 0L20 60');
  });
});

describe('scalePathData', () => {
  const parseNums = (d: string): number[] => (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

  it('scales M/L absolute and relative commands', () => {
    expect(scalePathData('M0 0 L10 20', 2, 3)).toBe('M0 0L20 60');
    expect(scalePathData('m0 0 l10 20', 2, 3)).toBe('m0 0l20 60');
  });

  it('scales T (smooth quadratic) like a plain coordinate pair', () => {
    expect(scalePathData('M0 0 Q5 5 10 10 T20 20', 2, 3)).toBe('M0 0Q10 15 20 30T40 60');
  });

  it('scales H with sx only and V with sy only, including implicit repeats', () => {
    expect(scalePathData('M0 0 H5 10', 2, 3)).toBe('M0 0H10 20');
    expect(scalePathData('M0 0 V5 10', 2, 3)).toBe('M0 0V15 30');
  });

  it('scales C control and end points alternately', () => {
    expect(scalePathData('M0 0 C1 2 3 4 5 6', 2, 3)).toBe('M0 0C2 6 6 12 10 18');
  });

  it('scales S and Q alternately', () => {
    expect(scalePathData('M0 0 S1 2 3 4', 2, 3)).toBe('M0 0S2 6 6 12');
    expect(scalePathData('M0 0 Q1 2 3 4', 2, 3)).toBe('M0 0Q2 6 6 12');
  });

  it('scales A rx/ry and endpoint but leaves rotation and flags untouched', () => {
    expect(scalePathData('M0 0 A5 10 30 1 0 20 40', 2, 3)).toBe('M0 0A10 30 30 1 0 40 120');
  });

  it('handles Z/z with no arguments', () => {
    expect(scalePathData('M0 0 L10 10 Z', 2, 3)).toBe('M0 0L20 30Z');
  });

  it('handles implicit repeated argument sets for M (treated as trailing L)', () => {
    expect(scalePathData('M0 0 10 10', 2, 3)).toBe('M0 0 20 30');
  });

  it('handles scientific notation', () => {
    expect(scalePathData('M1e-3 1.5E+2', 2, 3)).toBe(`M${1e-3 * 2} ${1.5e2 * 3}`);
  });

  it('handles comma, space, and no separators, including M10-5L3.5.5', () => {
    expect(scalePathData('M10,20L30,40', 2, 3)).toBe('M20 60L60 120');
    expect(scalePathData('M10 20 L30 40', 2, 3)).toBe('M20 60L60 120');
    const out = scalePathData('M10-5L3.5.5', 2, 3);
    const nums = parseNums(out);
    expect(nums).toEqual([20, -15, 7, 1.5]);
  });

  it('returns the same string for sx === 1 && sy === 1', () => {
    expect(scalePathData('M0 0 L10 20', 1, 1)).toBe('M0 0 L10 20');
  });

  it('returns input unchanged for non-finite or zero scale factors', () => {
    expect(scalePathData('M0 0 L10 20', NaN, 1)).toBe('M0 0 L10 20');
    expect(scalePathData('M0 0 L10 20', 0, 1)).toBe('M0 0 L10 20');
  });

  it('returns malformed path data unchanged instead of emitting corrupt geometry', () => {
    expect(scalePathData('M0 0 X10 20', 2, 3)).toBe('M0 0 X10 20');
    expect(scalePathData('L1 2 !!', 2, 3)).toBe('L1 2 !!');
    expect(scalePathData('10 20 M0 0', 2, 3)).toBe('10 20 M0 0');
  });

  it('round-trips: scaling by (2,3) then (0.5, 1/3) recovers the original geometry', () => {
    const original = 'M0 0 C1 2 3 4 5 6 A5 10 30 1 0 20 40 L100 -50 Z';
    const forward = scalePathData(original, 2, 3);
    const back = scalePathData(forward, 0.5, 1 / 3);
    const originalNums = parseNums(original);
    const roundTripNums = parseNums(back);
    expect(roundTripNums.length).toBe(originalNums.length);
    for (let i = 0; i < originalNums.length; i += 1) {
      expect(roundTripNums[i]).toBeCloseTo(originalNums[i], 3);
    }
  });
});

describe('scaleGeometry round trip via the full tree', () => {
  it('scaling by (2,3) then (0.5, 1/3) recovers original coordinates within epsilon', () => {
    const nodes: VNode[] = parseSvg(
      '<g><rect x="10" y="20" width="30" height="40" /><circle cx="5" cy="6" r="2" /><path d="M0 0 L10 20 C1 2 3 4 5 6" /></g>',
    );
    const forward = scaleGeometry(nodes, 2, 3);
    const back = scaleGeometry(forward, 0.5, 1 / 3);
    const rect = back[0].children[0];
    expect(Number(rect.attrs.x)).toBeCloseTo(10, 3);
    expect(Number(rect.attrs.y)).toBeCloseTo(20, 3);
    expect(Number(rect.attrs.width)).toBeCloseTo(30, 3);
    expect(Number(rect.attrs.height)).toBeCloseTo(40, 3);
  });
});

describe('transform-aware bounds', () => {
  it('bounds an elliptical arc by the curve it draws, not the numbers in the d string', () => {
    // Upper half of an ellipse centred at (50, 30): rx 50, ry 30, drawn right-to-left.
    const box = elementBounds(parseSvg('<path d="M 100 30 A 50 30 0 0 1 0 30" />')[0]);
    expect(box.x).toBeCloseTo(0, 1);
    expect(box.y).toBeCloseTo(30, 1);
    expect(box.w).toBeCloseTo(100, 1);
    expect(box.h).toBeCloseTo(30, 1);
  });

  it('bounds a quarter arc without inflating it to the whole ellipse', () => {
    const box = elementBounds(parseSvg('<path d="M 100 30 A 50 30 0 0 1 50 60" />')[0]);
    expect(box.x).toBeCloseTo(50, 1);
    expect(box.y).toBeCloseTo(30, 1);
    expect(box.w).toBeCloseTo(50, 1);
    expect(box.h).toBeCloseTo(30, 1);
  });

  it('follows relative commands, H/V and implicit repeats', () => {
    const box = elementBounds(parseSvg('<path d="M 10 10 h 20 v 10 l -5 5 Z" />')[0]);
    expect(box).toEqual({ x: 10, y: 10, w: 20, h: 15 });
  });

  it('bounds a cubic by its curve rather than its control hull', () => {
    const box = elementBounds(parseSvg('<path d="M 0 0 C 0 100 100 100 100 0" />')[0]);
    expect(box.h).toBeGreaterThan(70);
    expect(box.h).toBeLessThan(80);
  });

  it('moves an element box by its own translate()', () => {
    const box = elementBounds(parseSvg('<rect x="0" y="0" width="10" height="10" transform="translate(5 7)" />')[0]);
    expect(box).toEqual({ x: 5, y: 7, w: 10, h: 10 });
  });

  it('grows the box to cover a rotate() about a pivot', () => {
    const box = elementBounds(parseSvg('<rect x="0" y="0" width="100" height="40" transform="rotate(90 50 20)" />')[0]);
    expect(box.x).toBeCloseTo(30, 3);
    expect(box.y).toBeCloseTo(-30, 3);
    expect(box.w).toBeCloseTo(40, 3);
    expect(box.h).toBeCloseTo(100, 3);
  });

  it('follows a port marker through a translated group', () => {
    const g = parseSvg('<g transform="translate(10 20)"><circle cx="5" cy="5" r="2" /></g>')[0];
    expect(elementPoint(g.children[0])).toEqual({ x: 5, y: 5 });
    expect(elementPoint(g)).toEqual({ x: 15, y: 25 });
  });

  it('ignores a transform it cannot model', () => {
    const box = elementBounds(parseSvg('<rect x="0" y="0" width="10" height="10" transform="skewX(20)" />')[0]);
    expect(box).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('scales a rotate() pivot so a resized instance turns about the same spot', () => {
    const scaled = scaleGeometry(parseSvg('<rect transform="rotate(30 50 20)" />'), 2, 3);
    expect(scaled[0].attrs.transform).toBe('rotate(30 100 60)');
  });

  it('scales translate() inside a transform list', () => {
    const scaled = scaleGeometry(parseSvg('<g transform="translate(10 20) rotate(45 5 5)" />'), 2, 3);
    expect(scaled[0].attrs.transform).toBe('translate(20 60) rotate(45 10 15)');
  });
});

describe('elementOutline', () => {
  const outlineOf = (markup: string) => elementOutline(parseSvg(markup)[0]);

  it('traces a rectangle as a closed polygon', () => {
    const outline = outlineOf('<rect x="10" y="20" width="30" height="40" />');
    expect(outline).toEqual({
      kind: 'polygon',
      closed: true,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 60 },
        { x: 10, y: 60 },
      ],
    });
  });

  it('keeps a circle analytic', () => {
    expect(outlineOf('<circle cx="5" cy="6" r="7" />')).toEqual({
      kind: 'ellipse',
      c: { x: 5, y: 6 },
      rx: 7,
      ry: 7,
      rot: 0,
    });
  });

  it('samples an ellipse that carries its own transform', () => {
    const outline = outlineOf('<ellipse cx="0" cy="0" rx="10" ry="4" transform="translate(100 100)" />');
    expect(outline?.kind).toBe('polygon');
    if (outline?.kind === 'polygon') {
      const xs = outline.points.map((p) => p.x);
      expect(Math.min(...xs)).toBeCloseTo(90, 3);
      expect(Math.max(...xs)).toBeCloseTo(110, 3);
    }
  });

  it('leaves a polyline open and closes a polygon', () => {
    expect(outlineOf('<polyline points="0,0 10,0 10,10" />')).toMatchObject({ closed: false });
    expect(outlineOf('<polygon points="0,0 10,0 10,10" />')).toMatchObject({ closed: true });
  });

  it('follows a line and applies its transform', () => {
    expect(outlineOf('<line x1="0" y1="0" x2="10" y2="0" transform="translate(5 5)" />')).toEqual({
      kind: 'polygon',
      closed: false,
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ],
    });
  });

  it('reads a path and notices that it closes', () => {
    expect(outlineOf('<path d="M 0 0 L 10 0 L 10 10 Z" />')).toMatchObject({ closed: true });
    expect(outlineOf('<path d="M 0 0 L 10 0" />')).toMatchObject({ closed: false });
  });

  it('falls back to a child for a group and gives up on text', () => {
    expect(outlineOf('<g><rect x="0" y="0" width="4" height="4" /></g>')).toMatchObject({ kind: 'polygon' });
    expect(outlineOf('<text x="0" y="0">hi</text>')).toBeNull();
    expect(outlineOf('<rect x="0" y="0" width="0" height="10" />')).toBeNull();
  });
});
