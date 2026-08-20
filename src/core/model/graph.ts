import type { Rect, Transform, Vec } from '../geometry/index';
import * as geometryApi from '../geometry/index';
import { boundsOf, inflate, rect, rectContains, rectIntersects, rectUnion, toWorld, transformedBounds, rotate, norm } from '../geometry/index';
import { arrowHead, route as routeBetween, routeOrthogonalBest } from '../geometry/routing';
import type { RouteEndpoint } from '../geometry/routing';
import {
  isClosedOutline,
  outlineAttach,
  outlineBounds,
  outlineCenter,
  type AttachGrid,
  type Outline,
} from '../geometry/outline';
import type { ComponentEntry, LibraryRegistry } from '../library/registry';
import { compileScript, callHook, type CompiledScript } from '../script/sandbox';
import { DependencyTracker, depKeys } from '../script/tracker';
import {
  elementBounds,
  elementOutline,
  elementParts,
  elementPoint,
  findById,
  parseSvg,
  sanitize,
  scaleGeometry,
  svgBuilder,
  treeBounds,
  walk,
  type ElementPart,
  type VNode,
} from '../script/svg';
import { AlignmentIndex, SpatialHash } from '../spatial/index';
import { layoutMarkdown, markdownBounds, markdownChildren, type TextStyle } from '../text/markdown';
import { measureWidth, type FontSpec } from '../text/measure';
import { resolveAnnotations } from './annotations';
import { resolveBinding } from './bind';
import type { DocumentStore, Change } from './store';
import type {
  ComponentDef,
  Connection,
  Endpoint,
  GridConfig,
  Node,
  PortDirection,
  SwDocument,
} from './types';

/**
 * Routing options describing the document grid, so connectors prefer running along the
 * lines the user actually sees. Empty when the grid is hidden or snapping is off.
 */
function routingGridOf(grid: GridConfig): { grid?: number; gridOrigin?: Vec } {
  if (!grid?.snap) return {};
  const sub = Number.isFinite(grid.subdivisions) && grid.subdivisions >= 1 ? grid.subdivisions : 1;
  const step = Number.isFinite(grid.size) && grid.size > 0 ? grid.size / sub : 0;
  if (step <= 0) return {};
  return { grid: step, gridOrigin: { x: grid.origin?.x ?? 0, y: grid.origin?.y ?? 0 } };
}

/**
 * The same lattice, for pulling a sliding attach point onto a grid line. The editor's
 * connect preview has to use this too, or the point it draws would not be the one the
 * resolved connection ends up on.
 */
export function snapGridOf(grid: GridConfig): AttachGrid | undefined {
  const { grid: step, gridOrigin } = routingGridOf(grid);
  return step ? { step, origin: gridOrigin } : undefined;
}

/** Directions sampled around a sliding port when picking where a connector lands. */
const ATTACH_SAMPLES = 24;

interface Attach {
  pos: Vec;
  facing: Vec;
  outline?: Outline;
  portId?: string;
  group?: string[];
  error?: string;
}

/**
 * Every spot on a sliding port a connector might reasonably land on.
 *
 * The shape is sampled by direction rather than by arc length, because that is the aim a
 * port already understands: `settle` turns a point to aim at into the place on the shape a
 * ray from its centre leaves, along with the normal there. Sampling evenly around the
 * circle therefore covers a circle evenly, and a rectangle by its faces and corners, with
 * no per-shape code. Duplicates — several directions that land on the same corner of a
 * polygon — are dropped so they are not routed twice.
 */
function attachCandidates(ep: Attach, settle: (ep: Attach, toward: Vec) => Attach): Attach[] {
  if (!ep.outline) return [ep];
  const c = outlineCenter(ep.outline);
  const box = outlineBounds(ep.outline);
  const reach = Math.max(box.w, box.h) + 1;
  const out: Attach[] = [];
  for (let i = 0; i < ATTACH_SAMPLES; i += 1) {
    const a = (i / ATTACH_SAMPLES) * Math.PI * 2;
    const hit = settle(ep, { x: c.x + Math.cos(a) * reach, y: c.y + Math.sin(a) * reach });
    if (out.some((p) => Math.hypot(p.pos.x - hit.pos.x, p.pos.y - hit.pos.y) < 1e-6)) continue;
    out.push(hit);
  }
  return out.length > 0 ? out : [ep];
}

/**
 * Whether anything stands between two points. Rects covering either point are the nodes
 * those points belong to, which a route leaves rather than avoids.
 *
 * With a clear span the shortest route is the direct one, so the point on each shape facing
 * the other is already the best there is and the search below would only confirm it at the
 * cost of routing it a hundred times over. Nearly every connection on a sheet is this case.
 */
function obstructedBetween(a: Vec, b: Vec, obstacles: Rect[]): boolean {
  const span = boundsOf([a, b]);
  return obstacles.some((r) => !rectContains(r, a) && !rectContains(r, b) && rectIntersects(r, span));
}

export interface ResolvedPortInfo {
  id: string;
  name: string;
  direction: PortDirection;
  nodeId: string;
  /** World space. */
  pos: Vec;
  facing: Vec;
  localPos: Vec;
  /** Set when the whole element edge is connectable; `pos` is then its centre. */
  outline?: Outline;
  /**
   * Ids of every port on this node that shares this `name`, in declaration order,
   * present only when there is more than one. Same-named ports are one logical port:
   * a connector attaches to whichever member is easiest to reach, and they report a
   * shared connection list.
   */
  group?: string[];
  connected: boolean;
  connections: string[];
}

export interface ResolvedAnchorInfo {
  id: string;
  name: string;
  nodeId: string;
  pos: Vec;
  localPos: Vec;
}

export interface ResolvedHandleInfo {
  id: string;
  nodeId: string;
  pos: Vec;
  drives: string[];
  axis: 'x' | 'y' | 'both' | 'radial';
  min?: number;
  max?: number;
}

export interface LabelStyle {
  /** World-space font size: the element's own size scaled by the node transform. */
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: number;
  color: string;
  anchor: 'start' | 'middle' | 'end';
}

export interface ResolvedNodeInfo {
  id: string;
  node: Node;
  def: ComponentDef | null;
  effective: Transform;
  scaleX: number;
  scaleY: number;
  vnodes: VNode[];
  localBounds: Rect;
  bounds: Rect;
  /**
   * World-space box of each drawn primitive, keyed by element id where it has one. A
   * connector leaving a port on one primitive has to dodge the others, which a single
   * node-wide box cannot express.
   */
  parts: ElementPart[];
  ports: ResolvedPortInfo[];
  anchors: ResolvedAnchorInfo[];
  handles: ResolvedHandleInfo[];
  labels: Record<string, string>;
  /**
   * Rendered children of a markdown label, replacing the element's own text. Present only
   * for elements whose `label` annotation sets `markdown`.
   */
  labelNodes: Record<string, VNode[]>;
  /** World-space rect of each label-annotated element, keyed by SVG element id. */
  labelBoxes: Record<string, Rect>;
  /** How each label is drawn (world units), so the inline editor can match it. */
  labelStyles: Record<string, LabelStyle>;
  styles: Record<string, Record<string, string>>;
  hitAreas: string[];
  error: string | null;
  /** A script that worked but overran its time budget. Advisory only. */
  warning: string | null;
  logs: string[];
}

export interface ResolvedConnectionInfo {
  id: string;
  conn: Connection;
  points: Vec[];
  vnodes: VNode[];
  bounds: Rect;
  error: string | null;
  warning: string | null;
}

export interface ResolvedGraph {
  version: number;
  nodes: Map<string, ResolvedNodeInfo>;
  connections: Map<string, ResolvedConnectionInfo>;
  order: string[];
  connectionOrder: string[];
  bounds: Rect;
  errors: { id: string; message: string }[];
}

const DEFAULT_SIZE = { w: 100, h: 60 };

/** Rough vertical metrics, as fractions of the font size. */
const X_HEIGHT_RATIO = 0.52;
const ASCENT_RATIO = 0.8;
const DESCENT_RATIO = 0.2;

const DEFAULT_FONT = 'Inter, Segoe UI, sans-serif';
const MONO_FONT = 'JetBrains Mono, Consolas, monospace';

/**
 * Ink for anything the engine draws without being told a colour. It borrows from the
 * canvas palette so an unstyled label or connector follows the theme; the fallback is the
 * old fixed value, for the exporter and for any context with no stylesheet.
 */
const DEFAULT_INK = 'var(--sw-ink, #2e3440)';
const DEFAULT_CONNECTOR_STROKE = 'var(--sw-ink, #3b4252)';

/** SVG presentation attributes a `<text>` inherits from its ancestors. */
const INHERITED_TEXT_ATTRS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'fill',
  'text-anchor',
  'dominant-baseline',
] as const;

/** The element plus its ancestors, root first. */
function findPath(nodes: VNode[], id: string, trail: VNode[] = []): VNode[] | null {
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.attrs.id === id) return next;
    const found = findPath(node.children, id, next);
    if (found) return found;
  }
  return null;
}

/** Flatten inherited text attributes down an element path; the element itself wins. */
function inheritedTextAttrs(path: VNode[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of path ?? []) {
    for (const attr of INHERITED_TEXT_ATTRS) {
      const value = node.attrs[attr];
      if (value !== undefined) out[attr] = value;
    }
  }
  return out;
}

function numAttr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** How a label is drawn, in world units, so an editor can match it exactly. */
function labelStyle(attrs: Record<string, string>, scale: number): LabelStyle {
  const anchor = attrs['text-anchor'];
  return {
    fontSize: numAttr(attrs['font-size'], 12) * scale,
    fontFamily: attrs['font-family'] ?? DEFAULT_FONT,
    fontWeight: attrs['font-weight'] ?? 'normal',
    fontStyle: attrs['font-style'] ?? 'normal',
    letterSpacing: numAttr(attrs['letter-spacing'], 0) * scale,
    color: attrs.fill ?? DEFAULT_INK,
    anchor: anchor === 'middle' || anchor === 'end' ? anchor : 'start',
  };
}

/**
 * How far below the element's `y` the glyphs' baseline actually sits.
 *
 * `dominant-baseline` moves the text without moving `y`, so ignoring it puts the label
 * box — and the inline editor that follows it — above the text it belongs to.
 */
function baselineShift(attrs: Record<string, string>, size: number): number {
  switch (attrs['dominant-baseline']) {
    case 'middle':
      return (size * X_HEIGHT_RATIO) / 2;
    case 'central':
      return (size * (ASCENT_RATIO - DESCENT_RATIO)) / 2;
    case 'hanging':
      return size * ASCENT_RATIO * 0.8;
    case 'text-before-edge':
    case 'text-top':
      return size * ASCENT_RATIO;
    case 'text-after-edge':
    case 'text-bottom':
    case 'ideographic':
      return -size * DESCENT_RATIO;
    default:
      return 0;
  }
}

/**
 * The local-space box a label occupies. `elementBounds` reports a bare anchor point for
 * `<text>`, which is not enough to place the inline editor over the label or to tell two
 * labels on the same component apart, so text is measured from its font size and content.
 * The box hangs off the baseline, one font size up and a quarter down.
 */
export function labelBounds(
  element: VNode | null | undefined,
  fallback: Vec,
  text: string,
  attrs: Record<string, string>,
): Rect {
  if (!element) return rect(fallback.x, fallback.y, 0, 0);
  if (element.tag !== 'text') return elementBounds(element);
  const font = textFont(attrs);
  const w = measureWidth(text, font);
  const h = font.size * 1.25;
  const x = numAttr(element.attrs.x, 0);
  const baseline = numAttr(element.attrs.y, 0) + baselineShift(attrs, font.size);
  const anchor = attrs['text-anchor'];
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return rect(left, baseline - font.size, w, h);
}

/** The font a `<text>` draws with, from its own and its ancestors' presentation attributes. */
function textFont(attrs: Record<string, string>): FontSpec {
  return {
    family: attrs['font-family'] ?? DEFAULT_FONT,
    size: numAttr(attrs['font-size'], 12),
    weight: attrs['font-weight'] ?? '400',
    style: attrs['font-style'] ?? 'normal',
    letterSpacing: numAttr(attrs['letter-spacing'], 0),
  };
}

/** The same, as the base style a markdown block is laid out against. */
function markdownStyle(attrs: Record<string, string>): TextStyle {
  const font = textFont(attrs);
  return { ...font, monoFamily: MONO_FONT, color: attrs.fill ?? DEFAULT_INK };
}

/**
 * A node's local box, with `<text>` measured rather than reported as its bare anchor point.
 * A component that draws only text — a standalone label — would otherwise have a zero-sized
 * box and be impossible to hover, select or drag.
 */
export function boundsWithText(vnodes: VNode[], skip?: Set<string>): Rect {
  let box = treeBounds(vnodes);
  const visit = (vnode: VNode): void => {
    if (vnode.tag === 'text' && !(vnode.attrs.id && skip?.has(vnode.attrs.id))) {
      const measured = labelBounds(vnode, { x: 0, y: 0 }, vnode.text ?? '', vnode.attrs);
      if (measured.w > 0 && measured.h > 0) box = rectUnion(box, measured);
    }
    for (const child of vnode.children) visit(child);
  };
  for (const vnode of vnodes) visit(vnode);
  return box;
}

/** Cheap stable hash used to memoise static geometry compilation. */
function hashParams(params: Record<string, unknown>, size: { w: number; h: number }): string {
  return `${size.w}x${size.h}|${JSON.stringify(params)}`;
}

/** Lift a local-space element outline into world space through the node transform. */
export function toWorldOutline(outline: Outline | null, t: Transform): Outline | null {
  if (!outline) return null;
  if (outline.kind === 'polygon') {
    return { kind: 'polygon', points: outline.points.map((p) => toWorld(t, p)), closed: outline.closed };
  }
  return {
    kind: 'ellipse',
    c: toWorld(t, outline.c),
    rx: outline.rx * t.scale,
    ry: outline.ry * t.scale,
    rot: outline.rot + t.rot,
  };
}

/** How far past the endpoints (and past each obstacle found) the router looks for more. */
const ROUTE_QUERY_MARGIN = 80;

/**
 * World-space box of each drawn primitive of a node. Falls back to the node's own bounds
 * for a component with nothing drawn in it.
 */
function worldParts(vnodes: VNode[], t: Transform, bounds: Rect): ElementPart[] {
  const parts = elementParts(vnodes);
  if (parts.length === 0) return [{ id: '', bounds }];
  return parts.map((p) => ({ id: p.id, bounds: transformedBounds(t, p.bounds) }));
}

export interface GraphEngineOptions {
  scriptBudgetMs?: number;
  /** Cell size for the spatial hash; defaults to five grid cells. */
  cellSize?: number;
}

export class GraphEngine {
  readonly alignment = new AlignmentIndex();
  readonly spatial: SpatialHash;
  private tracker = new DependencyTracker();
  private scripts = new Map<string, CompiledScript>();
  private staticCache = new Map<string, { vnodes: VNode[]; bounds: Rect; scaleX: number; scaleY: number }>();
  private renderCache = new Map<string, { vnodes: VNode[]; styles: Record<string, Record<string, string>>; ports: unknown; logs: string[]; error: string | null; warning: string | null }>();
  private dirty = new Set<string>();
  private dirtyAll = true;
  private lastGraph: ResolvedGraph | null = null;
  private clockTick = 0;
  private budget: number;
  private disposeStore: (() => void) | null = null;
  /** Owner bounds for the connection currently rendering, read by the `route.*` script API so
   * scripted connectors (e.g. arrow.js) transparently avoid their own endpoint nodes. */
  private routingOwners: { from?: Rect; to?: Rect } | null = null;
  /** Document grid handed to the `route.*` script API, so connectors follow the drawn grid. */
  private routingGrid: { grid?: number; gridOrigin?: Vec } | null = null;

  constructor(
    private store: DocumentStore,
    private registry: LibraryRegistry,
    options: GraphEngineOptions = {},
  ) {
    this.budget = options.scriptBudgetMs ?? 8;
    this.spatial = new SpatialHash(options.cellSize ?? 100);
    this.disposeStore = store.onChange((changes) => this.onChanges(changes));
    registry.subscribe(() => {
      this.scripts.clear();
      this.staticCache.clear();
      this.renderCache.clear();
      this.dirtyAll = true;
    });
  }

  dispose(): void {
    this.disposeStore?.();
    this.disposeStore = null;
  }

  /** Advance the coarse clock signal so time-dependent scripts recompute. */
  tickClock(): void {
    this.clockTick += 1;
    for (const consumer of this.tracker.consumersOf([depKeys.clock()])) this.dirty.add(consumer);
  }

  private onChanges(changes: Change[]): void {
    const keys: string[] = [];
    for (const change of changes) {
      if (change.target === 'node') {
        keys.push(depKeys.node(change.id), depKeys.nodeTransform(change.id), depKeys.portsOf(change.id));
        this.renderCache.delete(change.id);
        for (const r of [change.before, change.after]) {
          const node = r as Node | undefined;
          if (!node) continue;
          const box = this.lastGraph?.nodes.get(node.id)?.bounds;
          if (box) for (const key of this.spatial.keysFor(box)) keys.push(depKeys.bucket(key));
        }
      } else if (change.target === 'connection') {
        keys.push(depKeys.connection(change.id));
        const from = (change.before ?? change.after) as Connection | undefined;
        if (from) {
          for (const ep of [from.from, from.to]) {
            if (ep.kind !== 'free') keys.push(depKeys.portsOf(ep.nodeId), depKeys.node(ep.nodeId));
          }
        }
      } else {
        keys.push(depKeys.doc(change.id));
        if (change.id === '*') this.dirtyAll = true;
      }
    }
    for (const consumer of this.tracker.consumersOf(keys)) this.dirty.add(consumer);
  }

  invalidateAll(): void {
    this.dirtyAll = true;
    this.renderCache.clear();
  }

  private script(entry: ComponentEntry | null): CompiledScript | null {
    if (!entry?.scriptSource) return null;
    const cached = this.scripts.get(entry.ref);
    if (cached && cached.source === entry.scriptSource) return cached;
    const logs: string[] = [];
    const compiled = compileScript(entry.scriptSource, {
      api: this.scriptApi(entry, logs),
      onLog: (level, args) => logs.push(`[${level}] ${args.map(String).join(' ')}`),
    });
    this.scripts.set(entry.ref, compiled);
    return compiled;
  }

  private scriptApi(entry: ComponentEntry, logs: string[]): Record<string, unknown> {
    const registry = this.registry;
    return {
      svg: svgBuilder,
      geometry: Object.freeze({ ...geometryApi }),
      route: Object.freeze({
        orthogonal: (a: Vec, b: Vec, opts: Record<string, unknown> = {}) =>
          routeBetween({ pos: a, facing: opts.fromFacing as Vec }, { pos: b, facing: opts.toFacing as Vec }, {
            ...this.routingGrid,
            ...(opts as object),
            style: 'orthogonal',
            fromOwnerBounds: this.routingOwners?.from,
            toOwnerBounds: this.routingOwners?.to,
          }),
        straight: (a: Vec, b: Vec, opts: Record<string, unknown> = {}) =>
          routeBetween({ pos: a }, { pos: b }, { ...(opts as object), style: 'straight' }),
        curve: (a: Vec, b: Vec, opts: Record<string, unknown> = {}) =>
          routeBetween({ pos: a, facing: opts.fromFacing as Vec }, { pos: b, facing: opts.toFacing as Vec }, {
            ...this.routingGrid,
            ...(opts as object),
            style: 'curve',
            fromOwnerBounds: this.routingOwners?.from,
            toOwnerBounds: this.routingOwners?.to,
          }),
        arrowHead,
      }),
      require: (name: string) => {
        const [libId, mod] = name.includes(':') ? name.split(':') : [entry.libId, name];
        const source = registry.sharedSource(libId === 'lib' ? entry.libId : libId, mod);
        if (!source) throw new Error(`shared module '${name}' not found`);
        const compiled = compileScript(source, {
          api: { svg: svgBuilder, geometry: geometryApi },
          onLog: (level, args) => logs.push(`[${level}] ${args.map(String).join(' ')}`),
        });
        if (compiled.error) throw new Error(compiled.error);
        return compiled.module;
      },
    };
  }

  /** Parses the component's static SVG and scales it to the instance size; result is cached per (def, size, params). */
  private staticGeometry(def: ComponentDef, node: Node): { vnodes: VNode[]; bounds: Rect; scaleX: number; scaleY: number } {
    const nominal = def.defaultSize ?? DEFAULT_SIZE;
    const resizable = def.resizable !== false;
    const scaleX = resizable && nominal.w > 0 ? node.size.w / nominal.w : 1;
    const scaleY = resizable && nominal.h > 0 ? node.size.h / nominal.h : 1;
    const key = `${def.id}@${def.version}|${hashParams(node.params, node.size)}`;
    const cached = this.staticCache.get(key);
    if (cached) return cached;
    const parsed = sanitize(parseSvg(def.geometry?.source ?? ''));
    const scaled = scaleGeometry(parsed, scaleX, scaleY);
    const value = { vnodes: scaled, bounds: treeBounds(scaled), scaleX, scaleY };
    this.staticCache.set(key, value);
    return value;
  }

  /** Full resolution pass. Only nodes whose dependencies changed re-run scripts. */
  resolve(): ResolvedGraph {
    const doc = this.store.getDocument();
    const nodes = new Map<string, ResolvedNodeInfo>();
    const connections = new Map<string, ResolvedConnectionInfo>();
    const errors: { id: string; message: string }[] = [];

    if (this.dirtyAll) {
      this.renderCache.clear();
      this.dirty.clear();
      this.dirtyAll = false;
    }

    // -- stage 1: static geometry, local annotation geometry ------------------
    const base = new Map<
      string,
      { node: Node; entry: ComponentEntry | null; vnodes: VNode[]; localBounds: Rect; scaleX: number; scaleY: number }
    >();
    for (const id of doc.nodeOrder) {
      const node = doc.nodes[id];
      if (!node) continue;
      const entry = this.registry.get(node.componentRef);
      const def = entry?.def ?? null;
      if (def) {
        const geom = this.staticGeometry(def, node);
        base.set(id, { node, entry, vnodes: geom.vnodes, localBounds: geom.bounds, scaleX: geom.scaleX, scaleY: geom.scaleY });
      } else {
        base.set(id, {
          node,
          entry,
          vnodes: placeholder(node),
          localBounds: rect(0, 0, node.size.w, node.size.h),
          scaleX: 1,
          scaleY: 1,
        });
      }
    }

    // -- stage 2: effective transforms (attachment chains) --------------------
    const effective = new Map<string, Transform>();
    const resolving = new Set<string>();
    // Rotation turns about the middle of the instance box, not its top-left corner,
    // so a rotated shape stays where it was drawn instead of swinging away.
    //
    // A drawing with no thickness on an axis turns about the drawing itself instead.
    // `base/line` draws along the top edge of a nominally 1-unit-tall box, so the box
    // centre sits half a unit below the line; a quarter turn would carry that half unit
    // onto the other axis and leave the line off the grid for good. Pivoting on the line
    // keeps it on the lattice at every right angle.
    const withPivot = (t: Transform, node: Node, bounds: Rect): Transform =>
      t.rot
        ? {
            ...t,
            pivot: {
              x: bounds.w > 0 ? node.size.w / 2 : bounds.x,
              y: bounds.h > 0 ? node.size.h / 2 : bounds.y,
            },
          }
        : t;
    const effectiveOf = (id: string): Transform => {
      const cached = effective.get(id);
      if (cached) return cached;
      const info = base.get(id);
      if (!info) return { x: 0, y: 0, rot: 0, scale: 1 };
      const attachment = info.node.attachment;
      if (!attachment || resolving.has(id)) {
        const own = withPivot(info.node.transform, info.node, info.localBounds);
        effective.set(id, own);
        return own;
      }
      resolving.add(id);
      const parent = base.get(attachment.parentId);
      let result = withPivot(info.node.transform, info.node, info.localBounds);
      if (parent) {
        const parentT = effectiveOf(attachment.parentId);
        const anchorLocal = localAnchorPoint(parent.entry?.def ?? null, parent.vnodes, attachment.anchorId);
        const world = toWorld(parentT, anchorLocal);
        result = {
          ...result,
          x: world.x + attachment.offset.x,
          y: world.y + attachment.offset.y,
        };
      } else {
        errors.push({ id, message: `attachment parent '${attachment.parentId}' is missing` });
      }
      resolving.delete(id);
      effective.set(id, result);
      return result;
    };
    for (const id of base.keys()) effectiveOf(id);

    // -- stage 3: connection lookup by port ----------------------------------
    const portConnections = new Map<string, string[]>();
    for (const id of doc.connectionOrder) {
      const conn = doc.connections[id];
      if (!conn) continue;
      for (const ep of [conn.from, conn.to]) {
        if (ep.kind !== 'port') continue;
        const key = `${ep.nodeId}:${ep.portId}`;
        const list = portConnections.get(key);
        if (list) list.push(id);
        else portConnections.set(key, [id]);
      }
    }

    // -- stage 4: resolve nodes (ports, anchors, handles, scripts) -----------
    for (const [id, info] of base) {
      const t = effective.get(id) ?? info.node.transform;
      const def = info.entry?.def ?? null;
      const resolved: ResolvedNodeInfo = {
        id,
        node: info.node,
        def,
        effective: t,
        scaleX: info.scaleX,
        scaleY: info.scaleY,
        vnodes: info.vnodes,
        localBounds: info.localBounds,
        bounds: rect(),
        parts: [],
        ports: [],
        anchors: [],
        handles: [],
        labels: {},
        labelNodes: {},
        labelBoxes: {},
        labelStyles: {},
        styles: {},
        hitAreas: [],
        error: info.entry ? null : `unknown component '${info.node.componentRef}'`,
        warning: null,
        logs: [],
      };
      nodes.set(id, resolved);
    }

    const graphApi = this.buildGraphApi(doc, nodes, portConnections);

    for (const [id, resolved] of nodes) {
      const info = base.get(id)!;
      const def = resolved.def;
      const local = (p: Vec): Vec => toWorld(resolved.effective, p);

      // ports / anchors / handles from static annotations
      const labelLocal = new Map<string, Rect>();
      const collect = (): void => {
        resolved.ports = [];
        resolved.anchors = [];
        resolved.handles = [];
        resolved.hitAreas = [];
        resolved.styles = {};
        resolved.labelNodes = {};
        labelLocal.clear();
        for (const [elId, ann] of resolveAnnotations(def, info.node.params)) {
          const element = findById(resolved.vnodes, elId);
          const point = element ? elementPoint(element) : { x: 0, y: 0 };
          if (ann.kind === 'port') {
            const facingLocal = ann.facing ? { x: ann.facing[0], y: ann.facing[1] } : { x: 0, y: 0 };
            const facing = resolved.effective.rot ? rotate(facingLocal, resolved.effective.rot) : facingLocal;
            const conns = portConnections.get(`${id}:${elId}`) ?? [];
            const outline =
              ann.surface === 'outline' && element
                ? toWorldOutline(elementOutline(element), resolved.effective)
                : null;
            resolved.ports.push({
              id: elId,
              name: ann.name ?? elId,
              direction: ann.direction ?? 'inout',
              nodeId: id,
              pos: outline ? outlineCenter(outline) : local(point),
              facing: norm(facing),
              localPos: point,
              ...(outline ? { outline } : {}),
              connected: conns.length > 0,
              connections: conns,
            });
          } else if (ann.kind === 'anchor') {
            resolved.anchors.push({ id: elId, name: ann.name ?? elId, nodeId: id, pos: local(point), localPos: point });
          } else if (ann.kind === 'handle') {
            resolved.handles.push({
              id: elId,
              nodeId: id,
              pos: local(point),
              drives: ann.drives ?? [],
              axis: ann.axis ?? 'both',
              ...(ann.min !== undefined ? { min: ann.min } : {}),
              ...(ann.max !== undefined ? { max: ann.max } : {}),
            });
          } else if (ann.kind === 'hit_area') {
            resolved.hitAreas.push(elId);
          } else if (ann.kind === 'style') {
            // Attributes the instance decides: the same thing a `style()` hook returns,
            // declared instead of coded. Element ids double as slot names in `render.ts`.
            const scope = { params: info.node.params, node: info.node, meta: doc.meta, size: info.node.size };
            const attrs: Record<string, string> = { ...resolved.styles[elId] };
            for (const [attr, binding] of Object.entries(ann.attrs ?? {})) {
              const value = resolveBinding(scope, binding);
              if (value !== '') attrs[attr] = value;
            }
            if (Object.keys(attrs).length > 0) resolved.styles[elId] = attrs;
          } else if (ann.kind === 'label') {
            const value = resolveBinding(
              { params: info.node.params, node: info.node, meta: doc.meta, size: info.node.size },
              ann.bind,
            );
            const attrs = inheritedTextAttrs(findPath(resolved.vnodes, elId));
            resolved.labels[elId] = value;
            resolved.labelStyles[elId] = labelStyle(attrs, resolved.effective.scale);
            const localBox =
              ann.markdown && element?.tag === 'text'
                ? (() => {
                    const layout = layoutMarkdown(value, markdownStyle(attrs));
                    resolved.labelNodes[elId] = markdownChildren(layout, point);
                    return markdownBounds(layout, point);
                  })()
                : labelBounds(element, point, value, attrs);
            labelLocal.set(elId, localBox);
            resolved.labelBoxes[elId] = transformedBounds(resolved.effective, localBox);
          }
        }
        linkPortGroups(resolved);
      };
      collect();

      // script hooks
      const entry = info.entry;
      const compiled = this.script(entry);
      if (compiled) {
        if (compiled.error) {
          resolved.error = compiled.error;
        } else {
          const cacheKey = id;
          const cached = !this.dirty.has(cacheKey) ? this.renderCache.get(cacheKey) : undefined;
          if (cached) {
            if (cached.vnodes.length > 0) resolved.vnodes = cached.vnodes;
            resolved.styles = { ...resolved.styles, ...cached.styles };
            resolved.logs = cached.logs;
            resolved.error = cached.error;
            resolved.warning = cached.warning;
            if (Array.isArray(cached.ports)) applyDynamicPorts(resolved, cached.ports as DynamicPort[], local, portConnections);
          } else {
            const logs: string[] = [];
            const ctx = this.buildNodeContext(doc, resolved, info, graphApi, logs);
            const result = this.tracker.track(cacheKey, () => {
              this.tracker.read(depKeys.node(id));
              const rendered = callHook<VNode | VNode[]>(compiled.module.render, ctx, this.budget);
              const styled = callHook<{ slots?: Record<string, Record<string, string>> }>(
                compiled.module.style,
                ctx,
                this.budget,
              );
              const ports = callHook<DynamicPort[]>(compiled.module.ports, ctx, this.budget);
              return { rendered, styled, ports };
            });
            const vnodes = normalizeRender(result.rendered.value);
            const styles = result.styled.value?.slots ?? {};
            const error = result.rendered.error ?? result.styled.error ?? result.ports.error;
            const warning = result.rendered.warning ?? result.styled.warning ?? result.ports.warning;
            if (vnodes.length > 0) resolved.vnodes = vnodes;
            resolved.styles = { ...resolved.styles, ...styles };
            resolved.logs = logs;
            if (error) resolved.error = error;
            if (warning) resolved.warning = warning;
            if (Array.isArray(result.ports.value)) {
              applyDynamicPorts(resolved, result.ports.value, local, portConnections);
            }
            this.renderCache.set(cacheKey, {
              vnodes,
              styles,
              ports: result.ports.value,
              logs,
              error: error ?? null,
              warning: warning ?? null,
            });
            this.dirty.delete(cacheKey);
          }
          if (resolved.vnodes !== info.vnodes) collectFromScript(resolved, def, local, portConnections, id);
        }
      }

      // Dynamic ports may have joined (or renamed) a group since the static pass.
      linkPortGroups(resolved);
      let localBox = boundsWithText(resolved.vnodes, new Set(labelLocal.keys()));
      // A bound label draws its *value*, which is rarely the sample text sitting in the
      // shape, so the box the graph measured for it is the one that counts.
      for (const box of labelLocal.values()) {
        if (box.w > 0 || box.h > 0) localBox = rectUnion(localBox, box);
      }
      resolved.localBounds = localBox;
      resolved.bounds = transformedBounds(resolved.effective, localBox);
      resolved.parts = worldParts(resolved.vnodes, resolved.effective, resolved.bounds);
      if (resolved.error) errors.push({ id, message: resolved.error });
    }

    // -- node index -----------------------------------------------------------
    // Filled *before* connections resolve: connector scripts query the spatial index
    // for obstacles, so indexing afterwards left every route believing the sheet was
    // empty on the first (and, for a freshly loaded document, only) resolve.
    for (const [id, resolved] of nodes) this.spatial.update(id, resolved.bounds);

    // -- stage 5: connections -------------------------------------------------
    for (const id of doc.connectionOrder) {
      const conn = doc.connections[id];
      if (!conn) continue;
      const resolvedConn = this.resolveConnection(doc, conn, nodes, graphApi);
      connections.set(id, resolvedConn);
      if (resolvedConn.error) errors.push({ id, message: resolvedConn.error });
    }

    // -- indexes --------------------------------------------------------------
    const seen = new Set<string>();
    let bounds: Rect | null = null;
    for (const [id, resolved] of nodes) {
      seen.add(id);
      this.alignment.updateRect(id, resolved.bounds, {
        xs: resolved.ports.map((p) => p.pos.x),
        ys: resolved.ports.map((p) => p.pos.y),
      });
      bounds = bounds ? rectUnion(bounds, resolved.bounds) : resolved.bounds;
    }
    for (const [id, conn] of connections) {
      seen.add(id);
      this.spatial.update(id, conn.bounds);
      bounds = bounds ? rectUnion(bounds, conn.bounds) : conn.bounds;
    }
    if (this.lastGraph) {
      for (const id of this.lastGraph.nodes.keys()) {
        if (!seen.has(id)) {
          this.spatial.remove(id);
          this.alignment.remove(id);
          this.tracker.forget(id);
          this.renderCache.delete(id);
        }
      }
      for (const id of this.lastGraph.connections.keys()) if (!seen.has(id)) this.spatial.remove(id);
    }

    const graph: ResolvedGraph = {
      version: this.store.revision,
      nodes,
      connections,
      order: doc.nodeOrder.filter((id) => nodes.has(id)),
      connectionOrder: doc.connectionOrder.filter((id) => connections.has(id)),
      bounds: bounds ?? rect(0, 0, 0, 0),
      errors,
    };
    this.lastGraph = graph;
    return graph;
  }

  private buildGraphApi(
    doc: SwDocument,
    nodes: Map<string, ResolvedNodeInfo>,
    portConnections: Map<string, string[]>,
  ): Record<string, unknown> {
    const tracker = this.tracker;
    const spatial = this.spatial;
    const snapshotNode = (info: ResolvedNodeInfo): Record<string, unknown> => ({
      id: info.id,
      ref: info.node.componentRef,
      x: info.effective.x,
      y: info.effective.y,
      rot: info.effective.rot,
      size: { ...info.node.size },
      params: { ...info.node.params },
      bounds: { ...info.bounds },
      ports: info.ports.map((p) => ({
        id: p.id,
        name: p.name,
        pos: { ...p.pos },
        facing: { ...p.facing },
        connected: p.connected,
        direction: p.direction,
        ...(p.group ? { group: [...p.group] } : {}),
      })),
    });

    return {
      node(id: string) {
        tracker.read(depKeys.node(id));
        const info = nodes.get(id);
        return info ? snapshotNode(info) : null;
      },
      nodes() {
        tracker.read(depKeys.all());
        return [...nodes.values()].map(snapshotNode);
      },
      nodesInRect(r: Rect) {
        for (const key of spatial.keysFor(r)) tracker.read(depKeys.bucket(key));
        return spatial
          .query(r)
          .map((id) => nodes.get(id))
          .filter((n): n is ResolvedNodeInfo => Boolean(n))
          .map(snapshotNode);
      },
      connectionsOf(nodeId: string, portId?: string) {
        tracker.read(depKeys.portsOf(nodeId));
        // A port id that belongs to a same-named group answers for the whole group.
        const group = portId
          ? nodes
              .get(nodeId)
              ?.ports.find((p) => p.id === portId)?.group
          : undefined;
        const keys = portId ? (group ?? [portId]).map((id) => `${nodeId}:${id}`) : [];
        const ids = portId
          ? [...new Set(keys.flatMap((key) => portConnections.get(key) ?? []))]
          : [...portConnections.entries()]
              .filter(([key]) => key.startsWith(`${nodeId}:`))
              .flatMap(([, list]) => list);
        return ids.map((id) => {
          tracker.read(depKeys.connection(id));
          const conn = doc.connections[id];
          return conn ? { id: conn.id, from: conn.from, to: conn.to, params: { ...conn.params } } : null;
        });
      },
      neighbors(nodeId: string) {
        tracker.read(depKeys.portsOf(nodeId));
        const out = new Set<string>();
        for (const conn of Object.values(doc.connections)) {
          const a = conn.from.kind !== 'free' ? conn.from.nodeId : null;
          const b = conn.to.kind !== 'free' ? conn.to.nodeId : null;
          if (a === nodeId && b) out.add(b);
          if (b === nodeId && a) out.add(a);
        }
        return [...out].map((id) => {
          const info = nodes.get(id);
          return info ? snapshotNode(info) : null;
        });
      },
      meta() {
        tracker.read(depKeys.doc('meta'));
        return { ...doc.meta };
      },
    };
  }

  private buildNodeContext(
    doc: SwDocument,
    resolved: ResolvedNodeInfo,
    info: { node: Node; scaleX: number; scaleY: number },
    graphApi: Record<string, unknown>,
    logs: string[],
  ): Record<string, unknown> {
    const tracker = this.tracker;
    const clock = this.clockTick;
    return Object.freeze({
      node: Object.freeze({
        id: resolved.id,
        ref: info.node.componentRef,
        x: resolved.effective.x,
        y: resolved.effective.y,
        rot: resolved.effective.rot,
        scaleX: info.scaleX,
        scaleY: info.scaleY,
      }),
      size: Object.freeze({ ...info.node.size }),
      params: Object.freeze({ ...info.node.params }),
      ports: Object.freeze(
        resolved.ports.map((p) =>
          Object.freeze({
            id: p.id,
            name: p.name,
            direction: p.direction,
            connected: p.connected,
            pos: Object.freeze({ ...p.pos }),
            localPos: Object.freeze({ ...p.localPos }),
            facing: Object.freeze({ ...p.facing }),
            ...(p.group ? { group: Object.freeze([...p.group]) } : {}),
          }),
        ),
      ),
      graph: Object.freeze(graphApi),
      env: Object.freeze({
        get now() {
          tracker.read(depKeys.clock());
          return Date.now();
        },
        get tick() {
          tracker.read(depKeys.clock());
          return clock;
        },
        unit: doc.grid.unit,
        grid: Object.freeze({ ...doc.grid }),
      }),
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    });
  }

  private resolveConnection(
    doc: SwDocument,
    conn: Connection,
    nodes: Map<string, ResolvedNodeInfo>,
    graphApi: Record<string, unknown>,
  ): ResolvedConnectionInfo {
    const attachGrid = snapGridOf(doc.grid);
    const resolveEndpoint = (
      ep: Endpoint,
      aim?: Vec,
    ): { pos: Vec; facing: Vec; outline?: Outline; portId?: string; group?: string[]; error?: string } => {
      if (ep.kind === 'free') return { pos: { x: ep.x, y: ep.y }, facing: { x: 0, y: 0 } };
      const target = nodes.get(ep.nodeId);
      if (!target) return { pos: { x: 0, y: 0 }, facing: { x: 0, y: 0 }, error: `missing node '${ep.nodeId}'` };
      if (ep.kind === 'port') {
        const stored = target.ports.find((p) => p.id === ep.portId);
        if (stored) {
          const port = pickGroupMember(target, stored, aim, attachGrid);
          return {
            pos: port.pos,
            facing: port.facing,
            portId: port.id,
            ...(port.group ? { group: port.group } : {}),
            ...(port.outline ? { outline: port.outline } : {}),
          };
        }
        return {
          pos: { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 },
          facing: { x: 0, y: 0 },
          error: `missing port '${ep.portId}' on '${ep.nodeId}'`,
        };
      }
      const anchor = target.anchors.find((a) => a.id === ep.anchorId);
      return anchor
        ? { pos: anchor.pos, facing: { x: 0, y: 0 } }
        : {
            pos: { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 },
            facing: { x: 0, y: 0 },
            error: `missing anchor '${ep.anchorId}'`,
          };
    };

    // A surface port has no fixed position: it lands where the connector meets
    // its edge. Both ends are aimed at the other's centre (or the nearest
    // waypoint) so the pair stays symmetric.
    const settle = (
      ep: { pos: Vec; facing: Vec; outline?: Outline; error?: string },
      toward: Vec,
    ): { pos: Vec; facing: Vec; error?: string } => {
      if (!ep.outline) return { pos: ep.pos, facing: ep.facing, ...(ep.error ? { error: ep.error } : {}) };
      const hit = outlineAttach(ep.outline, toward, attachGrid);
      return { pos: hit.pos, facing: hit.facing, ...(ep.error ? { error: ep.error } : {}) };
    };

    const firstWaypoint = conn.waypoints[0];
    const lastWaypoint = conn.waypoints[conn.waypoints.length - 1];
    // Same-named ports are one logical port, and choosing between their pins needs to
    // know where the other end is — so a grouped endpoint is resolved twice: once to
    // supply that aim, once to commit to the member nearest it.
    const fromFirst = resolveEndpoint(conn.from);
    const toFirst = resolveEndpoint(conn.to);
    const fromRaw = fromFirst.group ? resolveEndpoint(conn.from, firstWaypoint ?? toFirst.pos) : fromFirst;
    const toRaw = toFirst.group ? resolveEndpoint(conn.to, lastWaypoint ?? fromRaw.pos) : toFirst;
    const from0 = settle(fromRaw, firstWaypoint ?? toRaw.pos);
    const to0 = settle(toRaw, lastWaypoint ?? fromRaw.pos);
    const entry = this.registry.get(conn.componentRef);
    const compiled = this.script(entry);
    const logs: string[] = [];

    const avoid = conn.params.avoid !== false;
    // The box a stub has to clear before the search takes over. For a port drawn on one
    // primitive of a multi-part component that is the primitive itself, not the whole
    // node: the stub only has to get off its own stroke, and the siblings it must dodge
    // are handed to the router as ordinary obstacles below. Ports without a shape of
    // their own keep the old whole-node behaviour, since there is nothing finer to use.
    const ownerPart = (ep: Endpoint, chosenPortId?: string): Rect | undefined => {
      if (!avoid || ep.kind === 'free') return undefined;
      const info = nodes.get(ep.nodeId);
      if (!info) return undefined;
      if (ep.kind !== 'port' || info.hitAreas.length > 0) return info.bounds;
      const part = info.parts.find((p) => p.id === (chosenPortId ?? ep.portId));
      if (!part) return info.bounds;
      return part.bounds;
    };
    const fromOwnerBounds = ownerPart(conn.from, fromRaw.portId);
    const toOwnerBounds = ownerPart(conn.to, toRaw.portId);

    const obstacles: Rect[] = [];
    if (avoid) {
      /*
       * What the router is allowed to know about.
       *
       * A band around the straight line between the ports is not enough: the moment a
       * route has to detour it leaves that band, and anything it meets out there is
       * invisible to it — so it threads a gap it can see and drives straight through a box
       * it cannot. An obstacle you have to get around therefore brings its own
       * neighbourhood with it: the region grows to cover each rect it finds, and is asked
       * again, until nothing new turns up. That converges on exactly the space the route
       * might use, without a magic radius that is too small on one sheet and too slow on
       * the next.
       */
      const seen = new Set<string>();
      let region = inflate(boundsOf([from0.pos, to0.pos]), ROUTE_QUERY_MARGIN);
      for (;;) {
        let widened = false;
        for (const id of this.spatial.query(region)) {
          if (seen.has(id)) continue;
          const info = nodes.get(id);
          if (!info) continue;
          seen.add(id);
          // What the node actually occupies, which is its strokes and not the empty space
          // between them: a component goes in piece by piece so a route can use its gaps.
          // Declaring a hit area is how an author says otherwise — that the component is
          // one solid thing whatever it happens to be drawn from.
          if (info.hitAreas.length > 0) obstacles.push(info.bounds);
          else for (const part of info.parts) obstacles.push(part.bounds);
          const wider = rectUnion(region, inflate(info.bounds, ROUTE_QUERY_MARGIN));
          if (wider.w > region.w + 1e-6 || wider.h > region.h + 1e-6) {
            region = wider;
            widened = true;
          }
        }
        // The region only ever grows and the sheet is finite, so this settles on exactly
        // the space the route might use.
        if (!widened) break;
      }
    }

    /*
     * Where on a sliding surface port the connector should land.
     *
     * An attach point may sit anywhere on the shape — a connector meets a circle on the
     * diagonal as readily as on its sides — and which spot is best is a question about the
     * route, not about the two shapes. Aiming at the other end answers it wrongly the
     * moment anything is in the way: a port reached through a gap below is still aimed at
     * the partner off to the left, so the route detours up and back to touch a spot it had
     * already passed.
     *
     * So the spot is not guessed, it is searched for. Candidate points are taken all the
     * way round each shape and handed to the router together: it seeds its search from
     * every candidate at once and stops at the first one it reaches, which — because it
     * measures distance to the *nearest* remaining candidate — is provably the cheapest
     * pair. That is the standard super-source/super-target reduction, and it costs one
     * search rather than one per pair.
     *
     * Only closed outlines take part. An open stroke is met at the point nearest whatever
     * it is aimed at, so sampling it by direction would just walk its endpoints.
     */
    let from = from0;
    let to = to0;
    const fromSlides = !!fromRaw.outline && isClosedOutline(fromRaw.outline);
    const toSlides = !!toRaw.outline && isClosedOutline(toRaw.outline);
    const fromCenter = fromRaw.outline ? outlineCenter(fromRaw.outline) : from0.pos;
    const toCenter = toRaw.outline ? outlineCenter(toRaw.outline) : to0.pos;
    if (avoid && (fromSlides || toSlides) && obstacles.length > 0 && obstructedBetween(fromCenter, toCenter, obstacles)) {
      /*
       * The search has to be the route that will be drawn, or the cheapest attach found
       * here is the cheapest of a different problem. The connector renders itself, so its
       * own settings decide its geometry: a lead-in of 18 rather than the router's bare
       * default of 16 moves every corner. Parameters a stored connection predates are taken
       * from the component's declared defaults, which is what the script's own fallbacks
       * resolve to.
       */
      const declared: Record<string, unknown> = {};
      for (const def of entry?.def.params ?? []) declared[def.name] = def.default;
      const p = { ...declared, ...conn.params };
      const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
      const routeOpts = {
        obstacles,
        fromOwnerBounds,
        toOwnerBounds,
        stub: num(p.stub),
        clearance: num(p.clearance),
        bendPenalty: num(p.bendPenalty),
        router: p.router === 'simple' ? ('simple' as const) : ('auto' as const),
        ...routingGridOf(doc.grid),
      };

      const fromAttach = fromSlides ? attachCandidates(fromRaw, settle) : [from0];
      const toAttach = toSlides ? attachCandidates(toRaw, settle) : [to0];
      const fromEnds = fromAttach.map((a) => ({ pos: a.pos, facing: a.facing }));
      const toEnds = toAttach.map((a) => ({ pos: a.pos, facing: a.facing }));
      const pick = <T>(list: T[], ends: RouteEndpoint[], chosen: RouteEndpoint): T =>
        list[Math.max(0, ends.indexOf(chosen))];

      const waypoints = conn.waypoints;
      if (waypoints.length > 0) {
        // With waypoints the route is drawn one leg at a time, so each end is chosen
        // against the waypoint it actually meets rather than against the far port.
        const head = routeOrthogonalBest(fromEnds, [{ pos: waypoints[0] }], {
          ...routeOpts,
          toOwnerBounds: undefined,
        });
        from = pick(fromAttach, fromEnds, head.from);
        const tail = routeOrthogonalBest([{ pos: waypoints[waypoints.length - 1] }], toEnds, {
          ...routeOpts,
          fromOwnerBounds: undefined,
        });
        to = pick(toAttach, toEnds, tail.to);
      } else {
        const best = routeOrthogonalBest(fromEnds, toEnds, routeOpts);
        from = pick(fromAttach, fromEnds, best.from);
        to = pick(toAttach, toEnds, best.to);
      }
    }

    const ctx = Object.freeze({
      connection: Object.freeze({
        id: conn.id,
        from: Object.freeze({ pos: { ...from.pos }, facing: { ...from.facing } }),
        to: Object.freeze({ pos: { ...to.pos }, facing: { ...to.facing } }),
        waypoints: conn.waypoints.map((w) => ({ ...w })),
      }),
      params: Object.freeze({ ...conn.params }),
      obstacles: Object.freeze(obstacles.map((r) => Object.freeze({ ...r }))),
      graph: graphApi,
      env: Object.freeze({ grid: { ...doc.grid } }),
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    });

    let vnodes: VNode[] = [];
    let points: Vec[] = [];
    let error = from.error ?? to.error ?? null;
    let warning: string | null = null;

    if (compiled && !compiled.error && compiled.module.render) {
      this.routingOwners = { from: fromOwnerBounds, to: toOwnerBounds };
      this.routingGrid = routingGridOf(doc.grid);
      const result = this.tracker.track(conn.id, () => callHook<VNode | VNode[]>(compiled.module.render, ctx, this.budget));
      this.routingOwners = null;
      this.routingGrid = null;
      vnodes = normalizeRender(result.value);
      if (result.error) error = error ?? result.error;
      warning = result.warning;
      points = extractRoutePoints(vnodes, from.pos, to.pos);
    }
    if (vnodes.length === 0) {
      points = routeBetween(from, to, {
        style: (conn.params.style as 'straight' | 'orthogonal' | 'curve') ?? 'orthogonal',
        waypoints: conn.waypoints,
        obstacles,
        fromOwnerBounds,
        toOwnerBounds,
        ...routingGridOf(doc.grid),
      });
      vnodes = defaultConnectorVNodes(points, conn);
      if (compiled?.error) error = error ?? compiled.error;
    }

    const box = boundsOf(points.length > 0 ? points : [from.pos, to.pos]);
    return {
      id: conn.id,
      conn,
      points,
      vnodes,
      bounds: { x: box.x - 12, y: box.y - 12, w: box.w + 24, h: box.h + 24 },
      error,
      warning,
    };
  }
}

interface DynamicPort {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  pos?: Vec;
  facing?: Vec | [number, number];
  direction?: PortDirection;
}

/**
 * Ports on one node that share a name are one logical port. Members learn about each
 * other here, and their connection lists are merged so "is this port connected" (and a
 * script's `ctx.ports`) answers for the group rather than for one of its pins.
 */
function linkPortGroups(resolved: ResolvedNodeInfo): void {
  const byName = new Map<string, ResolvedPortInfo[]>();
  for (const port of resolved.ports) {
    const list = byName.get(port.name);
    if (list) list.push(port);
    else byName.set(port.name, [port]);
  }
  for (const members of byName.values()) {
    if (members.length < 2) {
      delete members[0].group;
      continue;
    }
    const ids = members.map((p) => p.id);
    const connections: string[] = [];
    for (const p of members) for (const c of p.connections) if (!connections.includes(c)) connections.push(c);
    for (const p of members) {
      p.group = ids;
      p.connections = connections;
      p.connected = connections.length > 0;
    }
  }
}

/**
 * How awkward it is to leave `port` towards `aim`: the distance the connector has to
 * cover, plus — when the port's normal points the other way — the detour needed to get
 * round the node, which is what makes a far pin on the near side beat a near pin facing
 * backwards.
 */
function groupMemberCost(target: ResolvedNodeInfo, port: ResolvedPortInfo, aim: Vec, grid?: AttachGrid): number {
  const at = port.outline ? outlineAttach(port.outline, aim, grid).pos : port.pos;
  const dx = aim.x - at.x;
  const dy = aim.y - at.y;
  const dist = Math.hypot(dx, dy);
  const facing = port.facing;
  if (dist < 1e-6 || (facing.x === 0 && facing.y === 0)) return dist;
  const away = Math.max(0, -((dx / dist) * facing.x + (dy / dist) * facing.y));
  return dist + away * (Math.abs(facing.x) * target.bounds.w + Math.abs(facing.y) * target.bounds.h);
}

/**
 * Pick the member of a same-named port group that is easiest to reach from `aim`. The
 * stored member wins ties, so a connection only ever hops when there is a real gain.
 */
export function pickGroupMember(
  target: ResolvedNodeInfo,
  stored: ResolvedPortInfo,
  aim: Vec | undefined,
  grid?: AttachGrid,
): ResolvedPortInfo {
  if (!stored.group || !aim) return stored;
  let best = stored;
  let bestCost = groupMemberCost(target, stored, aim, grid);
  for (const id of stored.group) {
    if (id === stored.id) continue;
    const candidate = target.ports.find((p) => p.id === id);
    if (!candidate) continue;
    const cost = groupMemberCost(target, candidate, aim, grid);
    if (cost < bestCost - 1e-6) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Every port id that stands in for this one: its same-named group, or just itself.
 * Two ids in the same group are the same logical port and must not be joined together.
 */export function portGroupIds(node: ResolvedNodeInfo | undefined, portId: string): string[] {
  return node?.ports.find((p) => p.id === portId)?.group ?? [portId];
}

function applyDynamicPorts(
  resolved: ResolvedNodeInfo,
  ports: DynamicPort[],
  local: (p: Vec) => Vec,
  portConnections: Map<string, string[]>,
): void {
  for (const port of ports) {
    if (!port || typeof port.id !== 'string') continue;
    const localPos = port.pos ?? { x: port.x ?? 0, y: port.y ?? 0 };
    const facing = Array.isArray(port.facing)
      ? { x: port.facing[0], y: port.facing[1] }
      : (port.facing ?? { x: 0, y: 0 });
    const conns = portConnections.get(`${resolved.id}:${port.id}`) ?? [];
    const existing = resolved.ports.findIndex((p) => p.id === port.id);
    const value: ResolvedPortInfo = {
      id: port.id,
      name: port.name ?? port.id,
      direction: port.direction ?? 'inout',
      nodeId: resolved.id,
      pos: local(localPos),
      localPos,
      facing: norm(facing),
      connected: conns.length > 0,
      connections: conns,
    };
    if (existing >= 0) resolved.ports[existing] = value;
    else resolved.ports.push(value);
  }
}

/** Re-read annotation geometry from script produced elements (ids must match). */
function collectFromScript(
  resolved: ResolvedNodeInfo,
  def: ComponentDef | null,
  local: (p: Vec) => Vec,
  portConnections: Map<string, string[]>,
  nodeId: string,
): void {
  for (const [elId, ann] of resolveAnnotations(def, resolved.node.params)) {
    const element = findById(resolved.vnodes, elId);
    if (!element) continue;
    const point = elementPoint(element);
    if (ann.kind === 'port') {
      const idx = resolved.ports.findIndex((p) => p.id === elId);
      const conns = portConnections.get(`${nodeId}:${elId}`) ?? [];
      const facing = ann.facing ? { x: ann.facing[0], y: ann.facing[1] } : { x: 0, y: 0 };
      const outline =
        ann.surface === 'outline' ? toWorldOutline(elementOutline(element), resolved.effective) : null;
      const value: ResolvedPortInfo = {
        id: elId,
        name: ann.name ?? elId,
        direction: ann.direction ?? 'inout',
        nodeId,
        pos: outline ? outlineCenter(outline) : local(point),
        localPos: point,
        facing: norm(facing),
        ...(outline ? { outline } : {}),
        connected: conns.length > 0,
        connections: conns,
      };
      if (idx >= 0) resolved.ports[idx] = value;
      else resolved.ports.push(value);
    } else if (ann.kind === 'anchor') {
      const idx = resolved.anchors.findIndex((a) => a.id === elId);
      const value: ResolvedAnchorInfo = {
        id: elId,
        name: ann.name ?? elId,
        nodeId,
        pos: local(point),
        localPos: point,
      };
      if (idx >= 0) resolved.anchors[idx] = value;
      else resolved.anchors.push(value);
    } else if (ann.kind === 'label') {
      resolved.labelBoxes[elId] = transformedBounds(resolved.effective, elementBounds(element));
    }
  }
}

function localAnchorPoint(def: ComponentDef | null, vnodes: VNode[], anchorId: string): Vec {
  const element = findById(vnodes, anchorId);
  if (element) return elementPoint(element);
  const box = treeBounds(vnodes);
  void def;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function normalizeRender(value: VNode | VNode[] | null): VNode[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return sanitize(list.filter((n): n is VNode => Boolean(n) && typeof n === 'object' && 'tag' in n));
}

function extractRoutePoints(vnodes: VNode[], from: Vec, to: Vec): Vec[] {
  let found: Vec[] | null = null;
  walk(vnodes, (node) => {
    if (found || node.attrs['data-swcad-route'] === undefined) return;
    try {
      const parsed = JSON.parse(node.attrs['data-swcad-route']) as Vec[];
      if (Array.isArray(parsed) && parsed.length > 1) found = parsed;
    } catch {
      /* ignore malformed route hints */
    }
  });
  return found ?? [from, to];
}

function defaultConnectorVNodes(points: Vec[], conn: Connection): VNode[] {
  const stroke = String(conn.params.stroke ?? DEFAULT_CONNECTOR_STROKE);
  const width = Number(conn.params.strokeWidth ?? 1.6);
  const radius = Number(conn.params.radius ?? 6);
  const head = conn.params.arrow === false ? null : arrowHead(points.at(-1)!, points.at(-2) ?? points[0], Number(conn.params.headSize ?? 9));
  const d = pathFromPoints(points, radius, String(conn.params.style ?? 'orthogonal'));
  const out: VNode[] = [
    svgBuilder.path({
      d,
      fill: 'none',
      stroke,
      'stroke-width': width,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'data-swcad-route': JSON.stringify(points),
    }),
  ];
  if (head) {
    out.push(
      svgBuilder.polygon({
        points: head.map((p) => `${p.x},${p.y}`).join(' '),
        fill: stroke,
      }),
    );
  }
  return out;
}

function pathFromPoints(points: Vec[], radius: number, style: string): string {
  const { polylinePath, smoothPath } = geometryApi;
  return style === 'curve' ? smoothPath(points) : polylinePath(points, radius);
}

function placeholder(node: Node): VNode[] {
  return [
    svgBuilder.rect({
      x: 0,
      y: 0,
      width: node.size.w,
      height: node.size.h,
      fill: '#fee',
      stroke: '#c33',
      'stroke-dasharray': '4 3',
    }),
    svgBuilder.text('missing component', {
      x: node.size.w / 2,
      y: node.size.h / 2,
      'text-anchor': 'middle',
      'font-size': 11,
      fill: '#c33',
    }),
  ];
}
