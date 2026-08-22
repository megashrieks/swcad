import type { ResolvedGraph } from '@core/model/graph';
import type { Endpoint, LegendConfig, PageConfig, SwDocument } from '@core/model/types';
import type { LibraryRegistry } from '@core/library/registry';
import { resolveThemeColorsIn, type ResolvedPalette } from '@core/theme/palette';
import { paletteColor, readCanvasPalette } from '../ui/canvasPalette';
import { connectionMarkup, nodeMarkup, nodeTransform } from './render';
import { legendMarkup, pageFrameParts, pageRect } from '../sheet/PageFrame';

export interface ExportOptions {
  padding?: number;
  /** A CSS colour, or `'none'` for a transparent export. Defaults to the themed paper. */
  background?: string;
  /** Export only these node ids (connections between them are kept). */
  only?: Set<string>;
  /**
   * Palette used to turn `var(--sw-*)` into literal colours. Defaults to the one the app
   * is currently showing, which makes an export match the screen.
   */
  palette?: ResolvedPalette;
}

/**
 * A connector belongs to an export of a selection only when both of its ends do. This
 * decides what is drawn *and* what the picture is cropped to: crop to every connector on
 * the sheet and exporting one node hands back a page of empty paper around it.
 */
function exported(info: { conn: { from: Endpoint; to: Endpoint } }, only?: Set<string>): boolean {
  if (!only) return true;
  for (const end of [info.conn.from, info.conn.to]) {
    if (end.kind !== 'free' && !only.has(end.nodeId)) return false;
  }
  return true;
}

function contentBounds(graph: ResolvedGraph, only?: Set<string>): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (r: { x: number; y: number; w: number; h: number }): void => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };
  for (const [id, info] of graph.nodes) {
    if (only && !only.has(id)) continue;
    add(info.bounds);
  }
  for (const info of graph.connections.values()) {
    if (!exported(info, only)) continue;
    for (const p of info.points) add({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Serialize the resolved graph (scripts already evaluated) to a standalone SVG document. */
export function exportSvg(
  doc: SwDocument,
  graph: ResolvedGraph,
  registry: LibraryRegistry,
  options: ExportOptions = {},
): string {
  const padding = options.padding ?? 24;
  const box = doc.page && !options.only ? pageRect(doc.page) : inflate(contentBounds(graph, options.only), padding);
  const palette = options.palette ?? readCanvasPalette();
  const paper = paletteColor(palette, doc.page ? '--sw-surface' : '--sw-paper', '#ffffff');

  const parts: string[] = [];
  if (options.background !== 'none') {
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${options.background ?? paper}" />`,
    );
  }
  if (doc.page && !options.only) parts.push(pageFrameMarkup(doc.page, palette));

  for (const info of graph.connections.values()) {
    if (!exported(info, options.only)) continue;
    parts.push(`<g>${connectionMarkup(info)}</g>`);
  }
  for (const id of doc.nodeOrder) {
    const info = graph.nodes.get(id);
    if (!info || (options.only && !options.only.has(id))) continue;
    parts.push(`<g transform="${nodeTransform(info)}">${nodeMarkup(info)}</g>`);
  }
  if (doc.page && doc.legend && !options.only) {
    parts.push(legendMarkup(doc.page, doc.legend as LegendConfig, doc.meta, registry));
  }

  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(box.w)}" height="${round(box.h)}"`,
    ` viewBox="${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}">`,
    parts.join(''),
    '</svg>',
  ].join('');

  // The file leaves the app, so nothing is left to resolve a custom property against:
  // bake the theme's colours in. Components that hardcoded a colour are untouched.
  return resolveThemeColorsIn(body, palette, paletteColor(palette, '--sw-ink', '#2e3440'));
}

/** The paper colour an export of this document would use, for the PNG under-fill. */
export function exportBackground(doc: SwDocument, palette: ResolvedPalette = readCanvasPalette()): string {
  return paletteColor(palette, doc.page ? '--sw-surface' : '--sw-paper', '#ffffff');
}

function pageFrameMarkup(page: PageConfig, palette: ResolvedPalette): string {
  const { sheet, border, ticks, zones } = pageFrameParts(page);
  // Kept in step with the `.page-*` rules in theme.css so an export matches the screen.
  const lineColor = paletteColor(palette, '--sw-line', '#8a8580');
  const frameColor = paletteColor(palette, '--sw-frame', '#3a3639');
  const zoneColor = paletteColor(palette, '--sw-zone', '#56514f');
  const parts = [
    `<rect x="${round(sheet.x)}" y="${round(sheet.y)}" width="${round(sheet.w)}" height="${round(sheet.h)}"` +
      ` fill="none" stroke="${lineColor}" stroke-width="1.4" />`,
  ];
  if (border) {
    parts.push(
      `<rect x="${round(border.x)}" y="${round(border.y)}" width="${round(Math.max(border.w, 0))}"` +
        ` height="${round(Math.max(border.h, 0))}" fill="none" stroke="${frameColor}" stroke-width="1.4" />`,
    );
  }
  for (const t of ticks) {
    parts.push(
      `<line x1="${round(t.x1)}" y1="${round(t.y1)}" x2="${round(t.x2)}" y2="${round(t.y2)}"` +
        ` stroke="${frameColor}" stroke-width="0.8" />`,
    );
  }
  for (const z of zones) {
    parts.push(
      `<text x="${round(z.x)}" y="${round(z.y)}" fill="${zoneColor}" font-size="9" font-family="${ZONE_FONT}"` +
        ` text-anchor="middle"${z.middle ? ' dominant-baseline="middle"' : ''}>${z.text}</text>`,
    );
  }
  return parts.join('');
}

/** Mirrors `--font` from the theme, since an exported SVG carries no stylesheet. */
const ZONE_FONT = 'Inter, Segoe UI, system-ui, sans-serif';

function inflate(r: { x: number; y: number; w: number; h: number }, by: number): { x: number; y: number; w: number; h: number } {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

const round = (v: number): number => Math.round(v * 100) / 100;

export function downloadText(filename: string, text: string, mime = 'image/svg+xml'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Rasterise an exported SVG string to a PNG download. */
export async function downloadPng(
  filename: string,
  svg: string,
  scale = 2,
  background = '#ffffff',
): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('failed to rasterise svg'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const href = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(href);
        }
        resolve();
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Print-to-PDF: opens a window containing the exported SVG at page size and
 * triggers the browser print dialog (the browser writes the PDF).
 */
export function printPdf(svg: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>${title}</title><style>@page{margin:0}body{margin:0}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`,
  );
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
