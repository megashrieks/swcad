import type { Rect } from '@core/geometry/index';
import type { LibraryRegistry } from '@core/library/registry';
import type { DocumentMeta, LegendConfig, PageConfig } from '@core/model/types';
import { staticMarkup } from '../editor/render';

/** World-space rect of a page. `page.scale` is world units per millimetre. */
export function pageRect(page: PageConfig): Rect {
  return { x: 0, y: 0, w: page.width * page.scale, h: page.height * page.scale };
}

export function pageInnerRect(page: PageConfig): Rect {
  const m = page.margin * page.scale;
  const outer = pageRect(page);
  return { x: outer.x + m, y: outer.y + m, w: outer.w - m * 2, h: outer.h - m * 2 };
}

const ZONE_LETTERS = 'ABCDEFGHJKLMNPRSTUV';

export interface PageFrameParts {
  /** Outline of the sheet itself. Always drawn, frame or not. */
  sheet: Rect;
  /** Inner (blueprint) border, only when the frame is enabled. */
  border: Rect | null;
  ticks: { x1: number; y1: number; x2: number; y2: number }[];
  zones: { x: number; y: number; text: string; middle: boolean }[];
}

/**
 * Geometry of the page frame, shared by the editor overlay and the exporter so a disabled
 * frame stays disabled in exported SVG/PNG.
 */
export function pageFrameParts(page: PageConfig): PageFrameParts {
  const outer = pageRect(page);
  const inner = pageInnerRect(page);
  const parts: PageFrameParts = { sheet: outer, border: null, ticks: [], zones: [] };
  if (!page.frame) return parts;
  parts.border = inner;
  if (!page.zones) return parts;

  const tick = 6 * page.scale;
  const cols = Math.max(2, Math.round(inner.w / (page.scale * 60)));
  const rows = Math.max(2, Math.round(inner.h / (page.scale * 60)));
  const colStep = inner.w / cols;
  const rowStep = inner.h / rows;

  for (let i = 0; i < cols; i += 1) {
    const cx = inner.x + colStep * (i + 0.5);
    const label = String(i + 1);
    parts.zones.push(
      { x: cx, y: inner.y - tick * 0.35, text: label, middle: false },
      { x: cx, y: inner.y + inner.h + tick * 0.9, text: label, middle: false },
    );
    if (i > 0) {
      const x = inner.x + colStep * i;
      parts.ticks.push(
        { x1: x, y1: outer.y, x2: x, y2: inner.y },
        { x1: x, y1: inner.y + inner.h, x2: x, y2: outer.y + outer.h },
      );
    }
  }
  for (let i = 0; i < rows; i += 1) {
    const cy = inner.y + rowStep * (i + 0.5);
    const label = ZONE_LETTERS[i % ZONE_LETTERS.length];
    parts.zones.push(
      { x: inner.x - tick * 0.5, y: cy, text: label, middle: true },
      { x: inner.x + inner.w + tick * 0.5, y: cy, text: label, middle: true },
    );
    if (i > 0) {
      const y = inner.y + rowStep * i;
      parts.ticks.push(
        { x1: outer.x, y1: y, x2: inner.x, y2: y },
        { x1: inner.x + inner.w, y1: y, x2: outer.x + outer.w, y2: y },
      );
    }
  }
  return parts;
}

export function PageFrame({
  page,
  meta,
  legend,
  registry,
}: {
  page: PageConfig;
  meta: DocumentMeta;
  legend: LegendConfig | null;
  registry: LibraryRegistry;
}): JSX.Element {
  const { sheet, border, ticks, zones } = pageFrameParts(page);

  return (
    <g className="page-frame">
      <rect x={sheet.x} y={sheet.y} width={sheet.w} height={sheet.h} className="page-sheet" />
      {border && <rect x={border.x} y={border.y} width={border.w} height={border.h} className="page-border" />}
      {ticks.map((t, i) => (
        <line key={`t${i}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="page-tick" />
      ))}
      {zones.map((z, i) => (
        <text
          key={`z${i}`}
          x={z.x}
          y={z.y}
          textAnchor="middle"
          dominantBaseline={z.middle ? 'middle' : undefined}
          className="page-zone"
        >
          {z.text}
        </text>
      ))}
      {legend && <Legend page={page} meta={meta} legend={legend} registry={registry} />}
    </g>
  );
}

/** Resolved legend markup plus its page-space placement (bottom-right of the inner frame). */
export function legendGeometry(
  page: PageConfig,
  legend: LegendConfig,
  meta: DocumentMeta,
  registry: LibraryRegistry,
): { markup: string; transform: string } | null {
  const entry = registry.get(legend.componentRef);
  if (!entry) return null;

  const scope = {
    meta: {
      ...meta,
      ...legend.fields,
      pageSize: page.preset,
      sheetLabel: `${meta.sheetNumber ?? 1}/${meta.sheetCount ?? 1}`,
      date: meta.date || new Date().toISOString().slice(0, 10),
    },
    params: {},
  };
  const { markup, size } = staticMarkup(entry.def, scope);
  const inner = pageInnerRect(page);
  // Scale the legend so it keeps a sensible physical size on any page.
  const scale = size.w > 0 ? (page.scale * 70) / size.w : 1;
  const x = inner.x + inner.w - size.w * scale;
  const y = inner.y + inner.h - size.h * scale;
  return { markup, transform: `translate(${x} ${y}) scale(${scale})` };
}

export function legendMarkup(
  page: PageConfig,
  legend: LegendConfig,
  meta: DocumentMeta,
  registry: LibraryRegistry,
): string {
  const geo = legendGeometry(page, legend, meta, registry);
  return geo ? `<g transform="${geo.transform}">${geo.markup}</g>` : '';
}

function Legend({
  page,
  meta,
  legend,
  registry,
}: {
  page: PageConfig;
  meta: DocumentMeta;
  legend: LegendConfig;
  registry: LibraryRegistry;
}): JSX.Element | null {
  const geo = legendGeometry(page, legend, meta, registry);
  if (!geo) return null;
  return <g className="page-legend" transform={geo.transform} dangerouslySetInnerHTML={{ __html: geo.markup }} />;
}
