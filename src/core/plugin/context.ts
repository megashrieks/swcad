import type { ResolvedGraph } from '../model/graph';
import type { DocumentStore } from '../model/store';
import type { Endpoint, SwDocument } from '../model/types';
import { callHook } from '../script/sandbox';
import type {
  PluginCapabilities,
  PluginCommand,
  PluginConnection,
  PluginContext,
  PluginEndpoint,
  PluginGrid,
  PluginNode,
} from './types';

/** How long a command may run before it is reported as slow. */
const COMMAND_BUDGET_MS = 400;

export interface PluginContextOptions {
  mode: 'sheet' | 'component';
  store: DocumentStore;
  graph: ResolvedGraph;
  selection: ReadonlySet<string>;
  snapEnabled: boolean;
  select: (ids: string[]) => void;
  caps: PluginCapabilities;
}

/** A file-safe stem for downloads, matching what the export buttons always used. */
export function documentBaseName(doc: SwDocument, fallback: string): string {
  return (doc.meta.title || fallback).replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || fallback;
}

function endpointOf(end: Endpoint): PluginEndpoint {
  if (end.kind === 'free') return { kind: 'free', x: end.x, y: end.y };
  if (end.kind === 'port') return { kind: 'port', nodeId: end.nodeId, portId: end.portId };
  return { kind: 'anchor', nodeId: end.nodeId, portId: end.anchorId };
}

function gridOf(doc: SwDocument, snapEnabled: boolean): PluginGrid {
  const size = Number.isFinite(doc.grid.size) && doc.grid.size > 0 ? doc.grid.size : 20;
  const subdivisions =
    Number.isFinite(doc.grid.subdivisions) && doc.grid.subdivisions >= 1 ? doc.grid.subdivisions : 1;
  return {
    size,
    subdivisions,
    originX: doc.grid.origin?.x ?? 0,
    originY: doc.grid.origin?.y ?? 0,
    unit: doc.grid.unit,
    snap: snapEnabled,
    step: size / subdivisions,
  };
}

/**
 * Freeze the document into the flat view a plugin reads. Taken once per command run, so
 * a command's own edits never move the ground under its plan.
 */
export function createPluginContext(options: PluginContextOptions): PluginContext {
  const { store, graph, selection, mode, caps } = options;
  const doc = store.getDocument();
  const grid = gridOf(doc, options.snapEnabled);

  const nodes: PluginNode[] = graph.order.flatMap((id) => {
    const info = graph.nodes.get(id);
    if (!info) return [];
    return [
      {
        id,
        ref: info.node.componentRef,
        name: info.def?.name ?? info.node.componentRef,
        x: info.node.transform.x,
        y: info.node.transform.y,
        w: info.node.size.w,
        h: info.node.size.h,
        rotation: info.node.transform.rot ?? 0,
        bounds: { ...info.alignBox },
        extent: { ...info.bounds },
        params: { ...info.node.params },
        ports: info.ports.map((p) => ({
          id: p.id,
          name: p.name,
          x: p.pos.x,
          y: p.pos.y,
          connected: p.connected,
        })),
        selected: selection.has(id),
        locked: Boolean(info.node.locked),
        attached: Boolean(info.node.attachment),
      },
    ];
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const connections: PluginConnection[] = graph.connectionOrder.flatMap((id) => {
    const info = graph.connections.get(id);
    if (!info) return [];
    return [
      {
        id,
        ref: info.conn.componentRef,
        from: endpointOf(info.conn.from),
        to: endpointOf(info.conn.to),
        selected: selection.has(id),
      },
    ];
  });

  const snapToGrid = (value: number): number => {
    if (!Number.isFinite(value) || grid.step <= 0) return value;
    return Math.round((value - grid.originX) / grid.step) * grid.step + grid.originX;
  };

  const movable = (id: string): boolean => {
    const node = byId.get(id);
    return Boolean(node && !node.locked && !node.attached);
  };

  const ctx: PluginContext = {
    mode,
    doc: {
      title: doc.meta.title ?? '',
      name: documentBaseName(doc, mode === 'component' ? 'component' : 'sheet'),
      kind: doc.kind,
      page: doc.page
        ? {
            preset: doc.page.preset,
            width: doc.page.width,
            height: doc.page.height,
            orientation: doc.page.orientation,
          }
        : null,
    },
    grid,
    nodes,
    connections,
    selection: [...selection],
    selected: () => nodes.filter((n) => n.selected),
    node: (id) => byId.get(id) ?? null,

    move: (id, x, y) => {
      if (!movable(id) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      store.updateNode(id, (node) => ({ transform: { ...node.transform, x, y } }));
    },
    moveBy: (id, dx, dy) => {
      const node = byId.get(id);
      if (!node) return;
      ctx.move(id, node.x + (dx || 0), node.y + (dy || 0));
    },
    resize: (id, w, h) => {
      if (!movable(id) || !(w > 0) || !(h > 0)) return;
      store.updateNode(id, () => ({ size: { w, h } }));
    },
    rotate: (id, degrees) => {
      if (!movable(id) || !Number.isFinite(degrees)) return;
      store.updateNode(id, (node) => ({ transform: { ...node.transform, rot: degrees } }));
    },
    setParam: (id, name, value) => {
      if (!byId.has(id) || typeof name !== 'string') return;
      store.updateNode(id, (node) => ({ params: { ...node.params, [name]: value } }));
    },
    remove: (id) => {
      if (byId.has(id)) store.removeNode(id);
      else if (graph.connections.has(id)) store.removeConnection(id);
    },
    select: (ids) => options.select(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []),

    snapToGrid,

    svg: (opts) => caps.svg(opts),
    download: (name, text, mime) => caps.download(name, text, mime),
    downloadPng: (name, svg, scale) => caps.downloadPng(name, svg ?? caps.svg(), scale ?? 2),
    print: (svg, title) => caps.print(svg ?? caps.svg({ selection: false }), title),
    notify: (message, title) => caps.notify(message, title),
  };

  return ctx;
}

/**
 * Run one command as a single undoable step, with the same error capture and time budget
 * a component script gets. A command that returns a promise (an export, say) is awaited
 * outside the transaction — nothing it does after the fact touches the document.
 */
export async function runPluginCommand(
  command: PluginCommand,
  ctx: PluginContext,
  store: DocumentStore,
): Promise<string | null> {
  if (typeof command.run !== 'function') return null;
  const label = `${command.label.toLowerCase()}`;
  const run = command.run as (ctx: unknown) => unknown;
  const result = store.transact(label, () => callHook<unknown>(run, ctx, COMMAND_BUDGET_MS));
  if (result.warning) console.warn(`[plugin] ${command.id}: ${result.warning}`);
  if (result.error) return result.error;
  const value = result.value as Promise<unknown> | null;
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    try {
      await value;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}

/** True when a command is offerable: it either does something or opens onto entries. */
export function commandUsable(command: PluginCommand, ctx: PluginContext): boolean {
  if (typeof command.enabled !== 'function') return true;
  try {
    return command.enabled(ctx) !== false;
  } catch {
    return false;
  }
}

export function commandActive(command: PluginCommand, ctx: PluginContext): boolean {
  if (typeof command.active !== 'function') return false;
  try {
    return command.active(ctx) === true;
  } catch {
    return false;
  }
}
