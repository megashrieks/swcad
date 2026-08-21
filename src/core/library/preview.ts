import * as geometryApi from '../geometry/index';
import { arrowHead, arrowHeadDepth, route as routeBetween } from '../geometry/routing';
import { compileScript, callHook } from '../script/sandbox';
import { sanitize, svgBuilder, type VNode } from '../script/svg';
import { scriptTextApi } from '../text/measure';
import type { ComponentEntry, LibraryRegistry } from './registry';

/**
 * Drawing a component outside a document.
 *
 * A palette picture used to be the component's static `shape.svg`, which is fine for a
 * shape that was drawn and useless for one that is computed: a scripted component ships
 * no geometry, so its tile came out blank. The fix is to run the same `render` hook the
 * sheet runs, against a made-up context — one node at the origin with its default
 * parameters, or, for a connector, one straight run left to right.
 *
 * The context is deliberately barren. There is no graph to ask about, so `ctx.graph`
 * answers "nothing there" rather than throwing: a component that colours itself by how
 * many of its ports are connected should draw its unconnected self in the palette, not an
 * error. Same for the clock — a preview is a still picture, so `tick` never advances.
 */

/** A preview is a thumbnail; a script that takes longer than this is not worth waiting for. */
const BUDGET_MS = 32;

const EMPTY_GRAPH = Object.freeze({
  node: () => null,
  nodes: () => [],
  nodesInRect: () => [],
  connectionsOf: () => [],
  neighbors: () => [],
  meta: () => ({}),
});

const GRID = Object.freeze({ size: 10, subdivisions: 1, origin: { x: 0, y: 0 }, unit: 'px', visible: true, snap: false });

/**
 * `require` for a preview, resolving `lib:name` against the library the component came
 * from. It mirrors the graph's own resolver, including the cycle guard — a shared module
 * that requires itself would otherwise recurse until the stack ran out.
 */
function makeRequire(registry: LibraryRegistry, libId: string, seen: ReadonlySet<string>): (name: string) => unknown {
  return (name: string) => {
    const [rawLib, mod] = name.includes(':') ? name.split(':') : [libId, name];
    const targetLib = rawLib === 'lib' ? libId : rawLib;
    const key = `${targetLib}:${mod}`;
    if (seen.has(key)) throw new Error(`shared module '${key}' requires itself`);
    const source = registry.sharedSource(targetLib, mod);
    if (!source) throw new Error(`shared module '${name}' not found`);
    const next = new Set(seen);
    next.add(key);
    const compiled = compileScript(source, {
      api: {
        svg: svgBuilder,
        geometry: geometryApi,
        text: scriptTextApi,
        require: makeRequire(registry, targetLib, next),
      },
      onLog: () => {},
    });
    if (compiled.error) throw new Error(compiled.error);
    return compiled.module;
  };
}

const routeApi = Object.freeze({
  orthogonal: (a: geometryApi.Vec, b: geometryApi.Vec, opts: Record<string, unknown> = {}) =>
    routeBetween({ pos: a, facing: opts.fromFacing as geometryApi.Vec }, { pos: b, facing: opts.toFacing as geometryApi.Vec }, {
      ...(opts as object),
      style: 'orthogonal',
    }),
  straight: (a: geometryApi.Vec, b: geometryApi.Vec, opts: Record<string, unknown> = {}) =>
    routeBetween({ pos: a }, { pos: b }, { ...(opts as object), style: 'straight' }),
  curve: (a: geometryApi.Vec, b: geometryApi.Vec, opts: Record<string, unknown> = {}) =>
    routeBetween({ pos: a, facing: opts.fromFacing as geometryApi.Vec }, { pos: b, facing: opts.toFacing as geometryApi.Vec }, {
      ...(opts as object),
      style: 'curve',
    }),
  arrowHead,
  arrowHeadDepth,
});

function nodeContext(entry: ComponentEntry, params: Record<string, unknown>, size: { w: number; h: number }): unknown {
  return Object.freeze({
    node: Object.freeze({ id: 'preview', ref: entry.ref, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1 }),
    size: Object.freeze({ ...size }),
    params: Object.freeze({ ...params }),
    ports: Object.freeze([]),
    graph: EMPTY_GRAPH,
    env: Object.freeze({ now: 0, tick: 0, unit: GRID.unit, grid: GRID }),
    log: () => {},
  });
}

/**
 * A connector has no drawing of its own until it is given two ends, so a preview invents
 * them: a straight run across the tile, both ends facing outwards along it, which is the
 * pose that shows an arrowhead and a dash pattern most plainly.
 */
function connectorContext(params: Record<string, unknown>, size: { w: number; h: number }): unknown {
  const y = size.h / 2;
  return Object.freeze({
    connection: Object.freeze({
      id: 'preview',
      from: Object.freeze({ pos: { x: 0, y }, facing: { x: 1, y: 0 } }),
      to: Object.freeze({ pos: { x: size.w, y }, facing: { x: -1, y: 0 } }),
      waypoints: [],
    }),
    params: Object.freeze({ ...params }),
    obstacles: Object.freeze([]),
    graph: EMPTY_GRAPH,
    env: Object.freeze({ grid: GRID }),
    log: () => {},
  });
}

export interface PreviewRender {
  vnodes: VNode[];
  styles: Record<string, Record<string, string>>;
}

/**
 * Run a component's `render` and `style` hooks for a thumbnail.
 *
 * Returns `null` when there is nothing to run or the script failed, so the caller can fall
 * back to the static drawing — a component with both keeps its picture either way.
 */
export function previewRender(
  registry: LibraryRegistry,
  entry: ComponentEntry,
  params: Record<string, unknown>,
  size: { w: number; h: number },
): PreviewRender | null {
  if (!entry.scriptSource) return null;
  const compiled = compileScript(entry.scriptSource, {
    api: {
      svg: svgBuilder,
      geometry: Object.freeze({ ...geometryApi }),
      text: scriptTextApi,
      route: routeApi,
      require: makeRequire(registry, entry.libId, new Set()),
    },
    onLog: () => {},
  });
  if (compiled.error) return null;
  const ctx = entry.def.connector ? connectorContext(params, size) : nodeContext(entry, params, size);
  const rendered = callHook<VNode | VNode[]>(compiled.module.render, ctx, BUDGET_MS);
  if (rendered.error) return null;
  const list = rendered.value ? (Array.isArray(rendered.value) ? rendered.value : [rendered.value]) : [];
  const vnodes = sanitize(list.filter((n): n is VNode => Boolean(n) && typeof n === 'object' && 'tag' in n));
  if (vnodes.length === 0) return null;
  const styled = callHook<{ slots?: Record<string, Record<string, string>> }>(compiled.module.style, ctx, BUDGET_MS);
  return { vnodes, styles: styled.value?.slots ?? {} };
}
