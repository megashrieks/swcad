import { useEffect, useRef } from 'react';
import type { GridConfig } from '@core/model/types';
import { paletteColor, useCanvasPalette } from '../../ui/canvasPalette';
import type { Guide, Measure, Viewport } from '../EditorController';

interface Size {
  w: number;
  h: number;
}

/**
 * Snaps a 1px stroke to the pixel it should cover.
 *
 * A 1px canvas line is painted half a pixel either side of the coordinate given, so it
 * only comes out crisp when that coordinate is a half-integer. `round(v) + 0.5` is the
 * usual trick, but it is biased: it shifts every line between a quarter and a whole pixel
 * *down and to the right* of the coordinate it claims to be at, which is exactly the
 * direction the SVG content is not moved in. Rounding to the nearest half-integer instead
 * keeps the line just as crisp with at most half a pixel of error either way, so the
 * lattice and the drawing agree about where a grid line is.
 */
const crisp = (v: number): number => Math.floor(v) + 0.5;

function setupCanvas(canvas: HTMLCanvasElement, size: Size): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(size.w * dpr));
  const height = Math.max(1, Math.floor(size.h * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  return ctx;
}

export function GridLayer({
  grid,
  viewport,
  size,
  page,
}: {
  grid: GridConfig;
  viewport: Viewport;
  size: Size;
  /** World-space rect of the sheet; when present the paper is painted under the grid. */
  page?: { x: number; y: number; w: number; h: number } | null;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const { tx, ty, zoom } = viewport;
  const { w, h } = size;
  const { size: gridSize, subdivisions, visible } = grid;
  const { x: originX, y: originY } = grid.origin;
  const pageX = page?.x ?? null;
  const pageY = page?.y ?? null;
  const pageW = page?.w ?? null;
  const pageH = page?.h ?? null;

  const palette = useCanvasPalette();
  // Read out here rather than inside the effect so the deps stay primitive and the layer
  // repaints the moment the theme changes.
  const paper = paletteColor(palette, '--sw-surface', '#ffffff');
  const minorColor = paletteColor(palette, '--sw-grid-minor', '#ece9e6');
  const majorColor = paletteColor(palette, '--sw-grid-major', '#dcd7d1');
  const axisColor = paletteColor(palette, '--sw-grid-axis', '#c8c2ba');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, { w, h });
    if (!ctx) return;

    const hasPage = pageX !== null && pageY !== null && pageW !== null && pageH !== null;
    if (hasPage) {
      ctx.fillStyle = paper;
      ctx.fillRect(pageX * zoom + tx, pageY * zoom + ty, pageW * zoom, pageH * zoom);
    }

    // The grid is the drawing lattice, not part of the paper: it keeps going past the
    // page edge so the sheet border is the only thing marking the page region.
    if (!visible) return;

    const minor = gridSize / Math.max(1, subdivisions);

    // Level of detail: skip a level whenever lines get closer than 6px.
    let step = minor;
    while (step * zoom < 6) step *= subdivisions > 1 ? subdivisions : 2;

    const worldLeft = (0 - tx) / zoom;
    const worldTop = (0 - ty) / zoom;
    const worldRight = (w - tx) / zoom;
    const worldBottom = (h - ty) / zoom;

    const drawLines = (spacing: number, color: string, width: number): void => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      const startX = Math.floor((worldLeft - originX) / spacing) * spacing + originX;
      for (let x = startX; x <= worldRight; x += spacing) {
        const sx = crisp(x * zoom + tx);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      const startY = Math.floor((worldTop - originY) / spacing) * spacing + originY;
      for (let y = startY; y <= worldBottom; y += spacing) {
        const sy = crisp(y * zoom + ty);
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    };

    drawLines(step, minorColor, 1);
    const major = step * (subdivisions > 1 ? subdivisions : 4);
    if (major * zoom >= 12) drawLines(major, majorColor, 1);

    // Origin axes
    ctx.beginPath();
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    const ox = crisp(originX * zoom + tx);
    const oy = crisp(originY * zoom + ty);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.stroke();
  }, [
    tx,
    ty,
    zoom,
    w,
    h,
    gridSize,
    subdivisions,
    originX,
    originY,
    visible,
    pageX,
    pageY,
    pageW,
    pageH,
    paper,
    minorColor,
    majorColor,
    axisColor,
  ]);

  return <canvas ref={ref} className="layer" style={{ width: w, height: h }} />;
}

const GUIDE_EDGE_MARGIN = 40;
const MAX_SECONDARY_GUIDES_PER_AXIS = 40;

interface ScreenGuide {
  axis: 'x' | 'y';
  screen: number;
  primary: boolean;
}

/** Keep every primary guide, plus the nearest-to-centre secondaries per axis, capped. */
function selectGuides(guides: Guide[], zoom: number, tx: number, ty: number, w: number, h: number): ScreenGuide[] {
  const byAxis: Record<'x' | 'y', ScreenGuide[]> = { x: [], y: [] };
  for (const guide of guides) {
    const screen = guide.axis === 'x' ? guide.coord * zoom + tx : guide.coord * zoom + ty;
    const bound = guide.axis === 'x' ? w : h;
    if (screen < -GUIDE_EDGE_MARGIN || screen > bound + GUIDE_EDGE_MARGIN) continue;
    // Guide.strength may be absent until EditorController publishes it; treat that as secondary.
    byAxis[guide.axis].push({ axis: guide.axis, screen, primary: guide.strength === 'primary' });
  }
  const pick = (axis: 'x' | 'y', center: number): ScreenGuide[] => {
    const lines = byAxis[axis];
    const primaries = lines.filter((l) => l.primary);
    const secondaries = lines
      .filter((l) => !l.primary)
      .sort((a, b) => Math.abs(a.screen - center) - Math.abs(b.screen - center))
      .slice(0, MAX_SECONDARY_GUIDES_PER_AXIS);
    return [...secondaries, ...primaries];
  };
  return [...pick('x', w / 2), ...pick('y', h / 2)];
}

/** Half-length of the bar that closes each end of a dimension bracket. */
const MEASURE_CAP = 5;
const MEASURE_ARROW = 6;
const MEASURE_FONT = '10px Inter, "Segoe UI", sans-serif';
/** Clear space either side of the label, where the dimension line breaks for it. */
const MEASURE_TEXT_PAD = 5;
/** Below this the bracket is more clutter than measurement. */
const MEASURE_MIN_PX = 14;
const MEASURE_MARGIN = 24;

/** `57`, or `57.5` — a distance in world units, at the precision a sheet is drawn to. */
function measureLabel(distance: number): string {
  const rounded = Math.round(distance * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * One dimension bracket: `|<--- 57 --->|`, the same drawing turned on its side for a
 * vertical gap.
 *
 * Drawn in screen space so the caps, heads and label keep their size at any zoom — the
 * number is the thing being read, and a bracket that scaled with the drawing would be
 * unreadable at the zoom levels where spacing actually matters. All of it is laid out in
 * `(along, across)` and mapped at the end, so the vertical case is the same code.
 */
function drawMeasure(
  ctx: CanvasRenderingContext2D,
  measure: Measure,
  viewport: Viewport,
  size: Size,
  color: string,
): void {
  const { tx, ty, zoom } = viewport;
  const horizontal = measure.axis === 'x';
  const a = measure.from * zoom + (horizontal ? tx : ty);
  const b = measure.to * zoom + (horizontal ? tx : ty);
  const cross = measure.at * zoom + (horizontal ? ty : tx);
  const span = b - a;
  if (!(span > MEASURE_MIN_PX)) return;

  const alongLimit = horizontal ? size.w : size.h;
  const crossLimit = horizontal ? size.h : size.w;
  if (b < -MEASURE_MARGIN || a > alongLimit + MEASURE_MARGIN) return;
  if (cross < -MEASURE_MARGIN || cross > crossLimit + MEASURE_MARGIN) return;

  const at = (along: number, across: number): [number, number] =>
    horizontal ? [along, cross + across] : [cross + across, along];

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  // The gap being copied is context, not the answer, so it reads as an echo of the one
  // the pointer is making.
  ctx.globalAlpha = measure.role === 'reference' ? 0.5 : 1;

  const segment = (u1: number, v1: number, u2: number, v2: number): void => {
    const [x1, y1] = at(u1, v1);
    const [x2, y2] = at(u2, v2);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  };

  ctx.font = MEASURE_FONT;
  const label = measureLabel(measure.distance);
  const textW = ctx.measureText(label).width;
  const mid = (a + b) / 2;
  const inline = span >= textW + 2 * (MEASURE_TEXT_PAD + MEASURE_ARROW + 2);

  ctx.beginPath();
  segment(a, -MEASURE_CAP, a, MEASURE_CAP);
  segment(b, -MEASURE_CAP, b, MEASURE_CAP);
  if (inline) {
    segment(a, 0, mid - textW / 2 - MEASURE_TEXT_PAD, 0);
    segment(mid + textW / 2 + MEASURE_TEXT_PAD, 0, b, 0);
  } else {
    segment(a, 0, b, 0);
  }
  ctx.stroke();

  if (span > MEASURE_ARROW * 2 + 4) {
    for (const [tip, dir] of [
      [a, 1],
      [b, -1],
    ] as const) {
      const [x0, y0] = at(tip, 0);
      const [x1, y1] = at(tip + dir * MEASURE_ARROW, -3);
      const [x2, y2] = at(tip + dir * MEASURE_ARROW, 3);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
    }
  }

  const [lx, ly] = at(mid, inline ? 0 : -7);
  ctx.translate(lx, ly);
  // A vertical dimension reads bottom-up, the way the connector captions do.
  if (!horizontal) ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

export function HighlightLayer({
  viewport,
  size,
  guides,
  measures,
  active,
}: {
  viewport: Viewport;
  size: Size;
  guides: Guide[];
  measures: Measure[];
  active: boolean;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const { tx, ty, zoom } = viewport;
  const { w, h } = size;

  const palette = useCanvasPalette();
  const guideColor = paletteColor(palette, '--sw-guide', '#c07d16');
  const guideWeakColor = paletteColor(palette, '--sw-guide-weak', 'rgba(192, 125, 22, 0.35)');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, { w, h });
    if (!ctx || !active) return;

    const lines = selectGuides(guides, zoom, tx, ty, w, h);

    const strokeLines = (subset: ScreenGuide[], color: string, width: number, dashed: boolean): void => {
      if (subset.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      for (const line of subset) {
        const at = crisp(line.screen);
        if (line.axis === 'x') {
          ctx.moveTo(at, 0);
          ctx.lineTo(at, h);
        } else {
          ctx.moveTo(0, at);
          ctx.lineTo(w, at);
        }
      }
      ctx.stroke();
    };

    // Secondaries drawn first (faint context), then the lines the geometry actually landed on:
    // a soft halo under a brighter dashed line, so a hit reads instantly against the near-misses.
    const hits = lines.filter((l) => l.primary);
    strokeLines(
      lines.filter((l) => !l.primary),
      guideWeakColor,
      1,
      false,
    );
    strokeLines(hits, guideWeakColor, 3, false);
    strokeLines(hits, guideColor, 1.5, true);
    ctx.setLineDash([]);

    for (const measure of measures) drawMeasure(ctx, measure, { tx, ty, zoom }, { w, h }, guideColor);
  }, [tx, ty, zoom, w, h, guides, measures, active, guideColor, guideWeakColor]);

  return <canvas ref={ref} className="layer" style={{ width: w, height: h }} />;
}
