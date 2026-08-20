import type { Rect, Vec } from '@core/geometry/index';
import { dist, rectContainsRect, rectFromPoints, snapTo } from '@core/geometry/index';
import type { RouteStyle } from '@core/geometry/routing';
import { outlineAttach, outlineBounds, outlineDistance, type AttachGrid, type Outline } from '@core/geometry/outline';
import type { GraphEngine, ResolvedGraph, ResolvedNodeInfo, ResolvedPortInfo } from '@core/model/graph';
import { snapGridOf } from '@core/model/graph';
import type { DocumentStore } from '@core/model/store';
import { uid } from '@core/model/store';
import type { LibraryRegistry } from '@core/library/registry';
import type { Connection, Endpoint, Node, ParamDef } from '@core/model/types';

export interface Viewport {
  tx: number;
  ty: number;
  zoom: number;
}

export type ToolId = 'select' | 'pan' | 'place' | 'connect';

export interface Guide {
  axis: 'x' | 'y';
  coord: number;
  sources: string[];
  strength: 'primary' | 'secondary';
}

export interface DragState {
  kind: 'move' | 'marquee' | 'connect' | 'resize' | 'pan' | 'waypoint';
  start: Vec;
  current: Vec;
  nodeIds: string[];
  origin: Map<string, { transform: { x: number; y: number }; size: { w: number; h: number } }>;
  from?: Endpoint;
  fromPos?: Vec;
  hoverPort?: ResolvedPortInfo | null;
  handleId?: string;
  /**
   * Distance from the grip to the corner of the instance box, captured when the drag starts.
   * A grip need not sit on that corner — the software symbols put theirs on the drawing,
   * which is inset — so without this the size would jump the moment one was grabbed.
   */
  sizeOffset?: Vec;
  connectionId?: string;
  waypointIndex?: number;
  moved: boolean;
}

export interface SnapResult {
  pos: Vec;
  guides: Guide[];
  /** Grid row/column highlighted for the current position. */
  gridLines: { x: number | null; y: number | null };
}

const SNAP_TOLERANCE_PX = 7;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const GUIDE_CAP_PER_AXIS = 64;
const CLIPBOARD_KIND = 'swcad/clipboard';

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: 1;
  /** Top-left of the copied nodes, so a paste can be re-anchored anywhere. */
  origin: Vec;
  nodes: Node[];
  connections: Connection[];
}

/**
 * Survives when the system clipboard is unavailable (permissions, insecure
 * origin) and keeps copy/paste working between the sheet and component editors.
 */
let memoryClipboard: ClipboardPayload | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const endpointNode = (ep: Endpoint, ids: Set<string>): boolean => ep.kind === 'free' || ids.has(ep.nodeId);

function remapEndpoint(ep: Endpoint, idMap: Map<string, string>, delta: Vec): Endpoint | null {
  if (ep.kind === 'free') return { kind: 'free', x: ep.x + delta.x, y: ep.y + delta.y };
  const nodeId = idMap.get(ep.nodeId);
  if (!nodeId) return null;
  return { ...ep, nodeId };
}

export function parseClipboard(text: string): ClipboardPayload | null {
  try {
    const data = JSON.parse(text) as ClipboardPayload;
    if (!data || data.kind !== CLIPBOARD_KIND || !Array.isArray(data.nodes) || data.nodes.length === 0) return null;
    return { ...data, connections: Array.isArray(data.connections) ? data.connections : [] };
  } catch {
    return null;
  }
}

async function writeSystemClipboard(payload: ClipboardPayload): Promise<void> {
  try {
    await navigator.clipboard?.writeText(JSON.stringify(payload));
  } catch {
    // Clipboard permission denied: the in-process copy still serves this session.
  }
}

async function readSystemClipboard(): Promise<ClipboardPayload | null> {
  try {
    const text = await navigator.clipboard?.readText();
    return text ? parseClipboard(text) : null;
  } catch {
    return null;
  }
}

/**
 * True when a surface port outlines a small annotated feature rather than the node's own body.
 * Compact ports behave like discrete ones: they can be hovered and dragged from in any tool.
 */
export function isCompactOutline(outline: Outline, bounds: Rect): boolean {
  const ob = outlineBounds(outline);
  // A line has no thickness and an arc very little, so one axis of the node's box is zero or
  // near it and an area ratio says nothing useful about either. What settles it is whether the
  // outline *spans* the node: if it does, the port is the body itself — the very thing the
  // select tool has to be able to grab — so only the connect tool may take the click.
  const spans = (o: number, b: number): boolean => b <= 0 || o >= b * 0.6;
  if (spans(ob.w, bounds.w) && spans(ob.h, bounds.h)) return false;
  // Otherwise it is a feature drawn inside a larger shape. Area keeps thin bars compact.
  const area = bounds.w * bounds.h;
  return area <= 0 || (ob.w * ob.h) / area <= 0.25;
}

/** The connector param the routing style lives in. Every connector component declares it. */
const ROUTE_STYLE_PARAM = 'style';

/** True when a component offers `style` as an enum that includes this router. */
function acceptsStyle(params: readonly ParamDef[] | undefined, style: RouteStyle): boolean {
  const def = params?.find((p) => p.name === ROUTE_STYLE_PARAM);
  return def?.type === 'enum' && (def.options ?? []).includes(style);
}

export class EditorController {
  viewport: Viewport = { tx: 80, ty: 80, zoom: 1 };
  /**
   * How big the drawing surface is on screen, kept up to date by whatever is showing it.
   * `fit` needs it, and the surface is the only thing that knows — the sheet editor and
   * the component editor put it in different places on the page.
   */
  viewSize: { w: number; h: number } = { w: 0, h: 0 };
  /**
   * Ceiling for `fit`. A sheet can fill the surface at any magnification, but a 120×70
   * component fitted to a whole pane would land at several hundred percent, where a
   * two-unit nudge crosses the screen — so the component editor lowers this. It lives on
   * the controller rather than on the call so that framing on open and the toolbar's
   * **Fit** button cannot disagree about it.
   */
  fitMaxZoom = MAX_ZOOM;
  /**
   * What `fit` has already framed, so opening a drawing frames it exactly once.
   *
   * It lives here rather than on the surface because the surface is unmounted whenever the
   * app switches to the component editor. Kept there, returning to the sheet would look
   * like a fresh open and throw away the pan and zoom the user had left behind.
   */
  framedKey: unknown = undefined;
  selection = new Set<string>();
  hoverId: string | null = null;
  hoverPort: ResolvedPortInfo | null = null;
  /** Last pointer position in world space; paste lands here. */
  cursorWorld: Vec | null = null;
  private lastPasteAt: Vec | null = null;
  tool: ToolId = 'select';
  placeRef: string | null = null;
  /**
   * Where the place tool sends its click when there is no component to drop. The component
   * editor uses it to put a meta part into the shape it is drawing: the bench has one node
   * on it - the draft - so placing there means editing that draft's file, not adding to the
   * document. `placeRef` wins when both are set.
   */
  onPlace: ((world: Vec, repeat: boolean) => void) | null = null;
  drag: DragState | null = null;
  guides: Guide[] = [];
  gridLines: { x: number | null; y: number | null } = { x: null, y: null };
  snapEnabled = true;
  showPorts = true;
  /**
   * Which router a connector drawn from here uses, and what the toolbar's routing group
   * shows when nothing is selected. It is a tool setting rather than a document one: the
   * style is stored per connection, so this is only the value the next one starts with.
   */
  connectStyle: RouteStyle = 'orthogonal';
  /**
   * Draw every annotated port and anchor, whatever the pointer is doing. The sheet keeps
   * them quiet until you approach a node, but in the component editor the annotations are
   * the thing you are working on - you are there to see which shape is a port.
   */
  revealAnnotations = false;
  /** The dashed box around a whole selected node. */
  showNodeOutline = true;
  editingLabel: { nodeId: string; elementId: string } | null = null;
  lastError: string | null = null;

  private listeners = new Set<() => void>();
  private graph: ResolvedGraph | null = null;
  private graphVersion = -1;
  private uiRevision = 0;

  constructor(
    readonly store: DocumentStore,
    readonly registry: LibraryRegistry,
    readonly engine: GraphEngine,
  ) {
    store.subscribe(() => {
      this.graph = null;
      this.notify();
    });
    registry.subscribe(() => {
      this.graph = null;
      this.notify();
    });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.uiRevision + this.store.revision;

  notify(): void {
    this.uiRevision += 1;
    for (const fn of this.listeners) fn();
  }

  /** Resolved graph for the current document revision (memoised per revision). */
  getGraph(): ResolvedGraph {
    if (!this.graph || this.graphVersion !== this.store.revision) {
      this.graph = this.engine.resolve();
      this.graphVersion = this.store.revision;
    }
    return this.graph;
  }

  invalidateGraph(): void {
    this.graph = null;
    this.graphVersion = -1;
  }

  // ------------------------------------------------------------- viewport

  toWorld(screen: Vec): Vec {
    const { tx, ty, zoom } = this.viewport;
    return { x: (screen.x - tx) / zoom, y: (screen.y - ty) / zoom };
  }

  toScreen(world: Vec): Vec {
    const { tx, ty, zoom } = this.viewport;
    return { x: world.x * zoom + tx, y: world.y * zoom + ty };
  }

  setViewport(next: Partial<Viewport>): void {
    this.viewport = { ...this.viewport, ...next };
    this.notify();
  }

  zoomAt(screen: Vec, factor: number): void {
    const before = this.toWorld(screen);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.viewport.zoom * factor));
    const tx = screen.x - before.x * zoom;
    const ty = screen.y - before.y * zoom;
    if (tx === this.viewport.tx && ty === this.viewport.ty && zoom === this.viewport.zoom) return;
    this.viewport = { tx, ty, zoom };
    this.notify();
  }

  /**
   * Slide the view so the world point currently under `screen` ends up at
   * `target` (screen space), leaving the zoom untouched.
   */
  recenter(screen: Vec, target: Vec): void {
    const dx = target.x - screen.x;
    const dy = target.y - screen.y;
    if (dx === 0 && dy === 0) return;
    this.panBy(dx, dy);
  }

  /** Pan by a screen-space delta (positive dx moves content right). */
  panBy(dx: number, dy: number): void {
    this.viewport = { ...this.viewport, tx: this.viewport.tx + dx, ty: this.viewport.ty + dy };
    this.notify();
  }

  /**
   * Centre the drawing in the surface, zoomed to fill it.
   *
   * `maxZoom` defaults to `fitMaxZoom`, which is what keeps small drawings sane; see the
   * field for why.
   */
  fit(viewSize: { w: number; h: number } = this.viewSize, padding = 60, maxZoom = this.fitMaxZoom): void {
    // Nothing measured yet: fitting to a zero-sized surface would throw the view away.
    if (viewSize.w <= 0 || viewSize.h <= 0) return;
    const bounds = this.getGraph().bounds;
    if (bounds.w <= 0 || bounds.h <= 0) {
      this.viewport = { tx: viewSize.w / 2, ty: viewSize.h / 2, zoom: 1 };
      this.notify();
      return;
    }
    const room = Math.min(padding * 2, viewSize.w * 0.25, viewSize.h * 0.25);
    const zoom = Math.min(
      maxZoom,
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((viewSize.w - room) / bounds.w, (viewSize.h - room) / bounds.h)),
    );
    this.viewport = {
      zoom,
      tx: viewSize.w / 2 - (bounds.x + bounds.w / 2) * zoom,
      ty: viewSize.h / 2 - (bounds.y + bounds.h / 2) * zoom,
    };
    this.notify();
  }

  // ------------------------------------------------------------ selection

  select(ids: string[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.notify();
  }

  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notify();
  }

  selectAll(): void {
    const graph = this.getGraph();
    this.selection = new Set([...graph.order, ...graph.connectionOrder]);
    this.notify();
  }

  selectedNodes(): ResolvedNodeInfo[] {
    const graph = this.getGraph();
    return [...this.selection].map((id) => graph.nodes.get(id)).filter((n): n is ResolvedNodeInfo => Boolean(n));
  }

  // ----------------------------------------------------------- hit testing
  //
  // Picking what the pointer is over lives in `EditorSurface`, not here: a node is only
  // "under the cursor" when its own drawing is, and the browser already answers that
  // exactly — including rotation, scale, fill rules and z-order — through the SVG it
  // painted. See `pickAt` there. Ports, handles and anchors stay geometric because they
  // are editor furniture with their own tolerances rather than painted shapes.

  portAt(world: Vec, includeSurface = true): ResolvedPortInfo | null {
    const graph = this.getGraph();
    const radius = 10 / this.viewport.zoom;
    let best: ResolvedPortInfo | null = null;
    let bestDist = Infinity;
    let compact: ResolvedPortInfo | null = null;
    let compactDist = Infinity;
    let edge: ResolvedPortInfo | null = null;
    let edgeDist = Infinity;
    for (const info of graph.nodes.values()) {
      if (info.node.hidden) continue;
      // A marker is a drawing aid in the component editor: its port exists to be *compiled*,
      // not to be wired up, so it must not steal the click that selects or moves the marker.
      if (info.def?.marker) continue;
      for (const port of info.ports) {
        if (port.outline) {
          // A broad surface port is the node's own body edge, so outside the connect tool it
          // must not steal the click that drags the node. A compact one marks a small feature
          // that was deliberately annotated as a port, so it stays grabbable in any tool.
          const small = isCompactOutline(port.outline, info.bounds);
          if (!includeSurface && !small) continue;
          const d = outlineDistance(port.outline, world);
          if (d > radius) continue;
          if (small) {
            if (d < compactDist) {
              compact = port;
              compactDist = d;
            }
          } else if (d < edgeDist) {
            edge = port;
            edgeDist = d;
          }
          continue;
        }
        const d = dist(port.pos, world);
        if (d <= radius && d < bestDist) {
          best = port;
          bestDist = d;
        }
      }
    }
    // A discrete port sits *on* the edge it belongs to, and a small annotated feature sits on
    // the body edge, so the more specific port always wins the tie.
    return best ?? compact ?? edge;
  }

  /** Where a connector should meet `port` when it arrives from `toward`. */
  portAttach(port: ResolvedPortInfo, toward: Vec): Vec {
    return port.outline ? outlineAttach(port.outline, toward, this.attachGrid()).pos : port.pos;
  }

  /**
   * The lattice sliding attach points snap to. Read from the document, not from
   * `snapEnabled`, so the preview matches the connection the graph resolves.
   */
  attachGrid(): AttachGrid | undefined {
    return snapGridOf(this.store.getDocument().grid);
  }

  /**
   * Puts the place tool away. Opening a component from the palette goes through a click that
   * arms it, so anything that swaps what is on the canvas has to disarm it — otherwise the
   * next click on the drawing drops a copy of the thing you opened.
   */
  disarmPlace(): void {
    if (this.placeRef === null && this.onPlace === null && this.tool !== 'place') return;
    this.placeRef = null;
    this.onPlace = null;
    if (this.tool === 'place') this.tool = 'select';
    this.notify();
  }

  handleAt(world: Vec): { nodeId: string; handleId: string; drives: string[] } | null {
    if (this.selection.size === 0) return null;
    const graph = this.getGraph();
    const radius = 8 / this.viewport.zoom;
    for (const id of this.selection) {
      const info = graph.nodes.get(id);
      if (!info) continue;
      for (const handle of info.handles) {
        if (dist(handle.pos, world) <= radius) {
          return { nodeId: id, handleId: handle.id, drives: handle.drives };
        }
      }
    }
    return null;
  }

  /**
   * Everything the marquee swallowed whole.
   *
   * A brush that merely touches something is ambiguous — the same sweep that reaches for one
   * component clips the neighbours it passes over — so an item joins the selection only when
   * its whole bounding box lies inside the rect. Dragging a box *around* what you mean is the
   * unambiguous gesture, and it is the one every CAD tool spells this way.
   */
  nodesIn(rect: Rect): string[] {
    const graph = this.getGraph();
    const out: string[] = [];
    // The index is queried with the rect itself: anything contained by it is also returned by
    // an overlap query, so the containment test only ever has to reject candidates.
    for (const id of this.engine.spatial.query(rect)) {
      const info = graph.nodes.get(id) ?? graph.connections.get(id);
      if (!info) continue;
      if ('node' in info && info.node.hidden) continue;
      if (rectContainsRect(rect, info.bounds)) out.push(id);
    }
    return out;
  }

  // -------------------------------------------------------------- snapping

  /**
   * Snap a moving position. All in-tolerance alignment guides are reported per
   * axis (nearest first), and whichever candidate — alignment or grid — lies
   * closer to the raw value wins the actual placement; alignment keeps a small
   * bias so it wins ties, since it reflects deliberate component layout rather
   * than an arbitrary lattice.
   */
  snap(world: Vec, movingIds: string[] = [], extraProbes: { xs: number[]; ys: number[] } = { xs: [], ys: [] }): SnapResult {
    const doc = this.store.getDocument();
    const tolerance = SNAP_TOLERANCE_PX / this.viewport.zoom;
    const exclude = new Set(movingIds);
    const epsilon = 2 / this.viewport.zoom;
    const step = safeStep(doc.grid.size, doc.grid.subdivisions);
    const gridActive = doc.grid.snap && step > 0;

    let x = world.x;
    let y = world.y;
    const guides: Guide[] = [];

    if (this.snapEnabled) {
      const probesX = [world.x, ...extraProbes.xs];
      const probesY = [world.y, ...extraProbes.ys];

      const candidatesX = gatherGuideCandidates(probesX, tolerance, exclude, (p, t, e) =>
        this.engine.alignment.queryX(p, t, e),
      );
      const candidatesY = gatherGuideCandidates(probesY, tolerance, exclude, (p, t, e) =>
        this.engine.alignment.queryY(p, t, e),
      );

      const bestX = pickAxisCandidate(candidatesX, world.x, gridActive, step, doc.grid.origin.x);
      const bestY = pickAxisCandidate(candidatesY, world.y, gridActive, step, doc.grid.origin.y);

      const choiceX = chooseAxisSnap(world.x, bestX, gridActive, step, doc.grid.origin.x, epsilon);
      const choiceY = chooseAxisSnap(world.y, bestY, gridActive, step, doc.grid.origin.y, epsilon);
      x = choiceX.value;
      y = choiceY.value;

      for (const c of candidatesX) {
        guides.push({ axis: 'x', coord: c.coord, sources: c.sources, strength: c.coord === choiceX.primaryCoord ? 'primary' : 'secondary' });
      }
      for (const c of candidatesY) {
        guides.push({ axis: 'y', coord: c.coord, sources: c.sources, strength: c.coord === choiceY.primaryCoord ? 'primary' : 'secondary' });
      }
    } else if (gridActive) {
      x = snapTo(world.x, step, doc.grid.origin.x);
      y = snapTo(world.y, step, doc.grid.origin.y);
    }

    return {
      pos: { x, y },
      guides,
      gridLines: {
        x: step > 0 ? snapTo(x, step, doc.grid.origin.x) : null,
        y: step > 0 ? snapTo(y, step, doc.grid.origin.y) : null,
      },
    };
  }

  // ------------------------------------------------------------ operations

  createNode(componentRef: string, world: Vec): Node | null {
    const entry = this.registry.get(componentRef);
    if (!entry) return null;
    const size = entry.def.defaultSize ?? { w: 120, h: 80 };
    const params: Record<string, unknown> = {};
    for (const def of entry.def.params ?? []) params[def.name] = def.default;
    const node: Node = {
      id: uid('n'),
      componentRef,
      transform: { x: world.x, y: world.y, rot: 0, scale: 1 },
      size: { ...size },
      params,
      z: this.store.getDocument().nodeOrder.length,
    };
    this.store.addNode(node);
    return node;
  }

  connect(from: Endpoint, to: Endpoint, componentRef = 'base/arrow'): Connection {
    const entry = this.registry.get(componentRef);
    const params: Record<string, unknown> = {};
    for (const def of entry?.def.params ?? []) params[def.name] = def.default;
    if (acceptsStyle(entry?.def.params, this.connectStyle)) params[ROUTE_STYLE_PARAM] = this.connectStyle;
    const conn: Connection = {
      id: uid('c'),
      componentRef,
      from,
      to,
      waypoints: [],
      params,
      z: this.store.getDocument().connectionOrder.length,
    };
    this.store.addConnection(conn);
    return conn;
  }

  /** The selected connections whose component understands `style`, in document order. */
  private styledSelection(): Connection[] {
    const doc = this.store.getDocument();
    return doc.connectionOrder
      .filter((id) => this.selection.has(id))
      .map((id) => doc.connections[id])
      .filter((conn): conn is Connection => !!conn && acceptsStyle(this.registry.get(conn.componentRef)?.def.params, 'straight'));
  }

  /**
   * What the routing control should show: the style the selected connectors agree on, or
   * `null` when they disagree. With no connector selected it is the style the next one
   * drawn will use.
   */
  activeConnectStyle(): RouteStyle | null {
    const conns = this.styledSelection();
    if (conns.length === 0) return this.connectStyle;
    const first = conns[0].params[ROUTE_STYLE_PARAM] ?? 'orthogonal';
    return conns.every((c) => (c.params[ROUTE_STYLE_PARAM] ?? 'orthogonal') === first)
      ? (first as RouteStyle)
      : null;
  }

  /**
   * Pick a router. Selected connectors are re-routed as one undo step, and the choice
   * sticks as the default for the next connector drawn — so it reads as a tool setting
   * whether or not anything is selected.
   */
  setConnectStyle(style: RouteStyle): void {
    this.connectStyle = style;
    const conns = this.styledSelection();
    if (conns.length > 0) {
      this.store.transact('routing', () => {
        for (const conn of conns) {
          this.store.updateConnection(conn.id, {
            params: { ...conn.params, [ROUTE_STYLE_PARAM]: style },
          });
        }
      });
    }
    this.notify();
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return;
    const ids = [...this.selection];
    this.store.transact('delete', () => {
      for (const id of ids) {
        if (this.store.getDocument().connections[id]) this.store.removeConnection(id);
      }
      for (const id of ids) {
        if (this.store.getDocument().nodes[id]) this.store.removeNode(id);
      }
    });
    this.selection.clear();
    this.notify();
  }

  duplicateSelection(): void {
    const payload = this.snapshotSelection();
    if (payload) this.pasteClipboard(payload, { x: 24, y: 24 });
  }

  /**
   * Snapshot of the selected nodes plus every connection whose two endpoints are
   * both in the selection, in a form that survives a round trip through text.
   */
  snapshotSelection(): ClipboardPayload | null {
    const doc = this.store.getDocument();
    const nodeIds = [...this.selection].filter((id) => doc.nodes[id]);
    if (nodeIds.length === 0) return null;
    const inCopy = new Set(nodeIds);
    const nodes = doc.nodeOrder.filter((id) => inCopy.has(id)).map((id) => clone(doc.nodes[id]));
    const connections = doc.connectionOrder
      .map((id) => doc.connections[id])
      .filter((conn) => conn && endpointNode(conn.from, inCopy) && endpointNode(conn.to, inCopy))
      .map((conn) => clone(conn));
    let origin = { x: Infinity, y: Infinity };
    for (const node of nodes) {
      origin = { x: Math.min(origin.x, node.transform.x), y: Math.min(origin.y, node.transform.y) };
    }
    return { kind: CLIPBOARD_KIND, version: 1, origin, nodes, connections };
  }

  /** Copies the selection to the in-process clipboard and, when allowed, the system one. */
  copySelection(): ClipboardPayload | null {
    const payload = this.snapshotSelection();
    if (!payload) return null;
    memoryClipboard = payload;
    void writeSystemClipboard(payload);
    return payload;
  }

  cutSelection(): ClipboardPayload | null {
    const payload = this.copySelection();
    if (payload) this.deleteSelection();
    return payload;
  }

  /** Reads the system clipboard when it holds a swcad payload, else the in-process one. */
  async readClipboard(): Promise<ClipboardPayload | null> {
    const external = await readSystemClipboard();
    return external ?? memoryClipboard;
  }

  /**
   * Inserts a copied payload. Without an explicit offset the paste lands under the
   * cursor (snapped), so repeated pastes do not stack on top of each other.
   */
  pasteClipboard(payload: ClipboardPayload, offset?: Vec): string[] {
    if (!payload || payload.nodes.length === 0) return [];
    const delta = offset ?? this.pasteDelta(payload.origin);
    const idMap = new Map<string, string>();
    for (const node of payload.nodes) idMap.set(node.id, uid('n'));
    const created: string[] = [];

    this.store.transact('paste', () => {
      for (const node of payload.nodes) {
        const copy: Node = {
          ...clone(node),
          id: idMap.get(node.id)!,
          transform: { ...node.transform, x: node.transform.x + delta.x, y: node.transform.y + delta.y },
          z: this.store.getDocument().nodeOrder.length,
        };
        // An attachment only survives if its parent came along; otherwise the copy
        // would be pinned to a component that is not part of the paste.
        const parent = node.attachment ? idMap.get(node.attachment.parentId) : undefined;
        if (node.attachment && parent) copy.attachment = { ...node.attachment, parentId: parent };
        else delete copy.attachment;
        this.store.addNode(copy);
        created.push(copy.id);
      }
      for (const conn of payload.connections) {
        const from = remapEndpoint(conn.from, idMap, delta);
        const to = remapEndpoint(conn.to, idMap, delta);
        if (!from || !to) continue;
        const copy: Connection = {
          ...clone(conn),
          id: uid('c'),
          from,
          to,
          waypoints: conn.waypoints.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
          z: this.store.getDocument().connectionOrder.length,
        };
        this.store.addConnection(copy);
        created.push(copy.id);
      }
    });

    if (created.length > 0) this.select(created);
    return created;
  }

  /** Offset that lands the payload's top-left under the cursor, snapped to the grid. */
  private pasteDelta(origin: Vec): Vec {
    if (!this.cursorWorld) return { x: 24, y: 24 };
    const target = this.snapEnabled ? this.snap(this.cursorWorld).pos : this.cursorWorld;
    // Repeated pastes without moving the mouse would land exactly on top of each
    // other, so each one steps off by a grid cell.
    const grid = this.store.getDocument().grid;
    const step = safeStep(grid.size, grid.subdivisions) || 24;
    let cascade = 0;
    while (this.lastPasteAt && dist(this.lastPasteAt, { x: target.x + cascade, y: target.y + cascade }) < 1e-6) {
      cascade += step;
    }
    const placed = { x: target.x + cascade, y: target.y + cascade };
    this.lastPasteAt = placed;
    return { x: placed.x - origin.x, y: placed.y - origin.y };
  }

  nudge(dx: number, dy: number): void {
    const ids = [...this.selection].filter((id) => this.store.getDocument().nodes[id]);
    if (ids.length === 0) return;
    this.store.transact('nudge', () => {
      for (const id of ids) {
        this.store.updateNode(id, (node) => ({
          transform: { ...node.transform, x: node.transform.x + dx, y: node.transform.y + dy },
        }));
      }
    });
  }

  bringToFront(): void {
    const doc = this.store.getDocument();
    const ids = [...this.selection].filter((id) => doc.nodes[id]);
    if (ids.length === 0) return;
    this.store.setNodeOrder([...doc.nodeOrder.filter((id) => !ids.includes(id)), ...ids]);
  }

  sendToBack(): void {
    const doc = this.store.getDocument();
    const ids = [...this.selection].filter((id) => doc.nodes[id]);
    if (ids.length === 0) return;
    this.store.setNodeOrder([...ids, ...doc.nodeOrder.filter((id) => !ids.includes(id))]);
  }

  /** The selected nodes, as a set, for the paint-order walks below. */
  private selectedInOrder(): { order: string[]; ids: Set<string> } {
    const doc = this.store.getDocument();
    return {
      order: doc.nodeOrder,
      ids: new Set([...this.selection].filter((id) => doc.nodes[id])),
    };
  }

  /**
   * One step forward through the paint order — over the nearest thing that is currently
   * drawn on top of the selection.
   *
   * The walk starts at the front, so a run of selected nodes hops the same neighbour
   * together and keeps its own internal order. Stepping each one in turn from the back
   * would have them trample each other and arrive reversed.
   */
  moveForward(): void {
    const { order, ids } = this.selectedInOrder();
    if (ids.size === 0) return;
    const next = [...order];
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (ids.has(next[i]) && !ids.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
    this.store.setNodeOrder(next);
  }

  /** One step back through the paint order — under the nearest thing the selection covers. */
  moveBackward(): void {
    const { order, ids } = this.selectedInOrder();
    if (ids.size === 0) return;
    const next = [...order];
    for (let i = 1; i < next.length; i += 1) {
      if (ids.has(next[i]) && !ids.has(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1], next[i]];
    }
    this.store.setNodeOrder(next);
  }

  /**
   * Whether anything unselected is still in front of the selection — which is also the
   * question "would forward, or front, change anything", and so what greys the buttons out.
   */
  canMoveForward(): boolean {
    const { order, ids } = this.selectedInOrder();
    const first = order.findIndex((id) => ids.has(id));
    if (first < 0) return false;
    for (let i = first + 1; i < order.length; i += 1) if (!ids.has(order[i])) return true;
    return false;
  }

  /** Whether anything unselected is still behind the selection. */
  canMoveBackward(): boolean {
    const { order, ids } = this.selectedInOrder();
    let last = -1;
    for (let i = order.length - 1; i >= 0; i -= 1) {
      if (ids.has(order[i])) {
        last = i;
        break;
      }
    }
    if (last < 0) return false;
    for (let i = 0; i < last; i += 1) if (!ids.has(order[i])) return true;
    return false;
  }

  align(edge: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'): void {
    const nodes = this.selectedNodes();
    if (nodes.length < 2) return;
    const boxes = nodes.map((n) => n.bounds);
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    this.store.transact(`align ${edge}`, () => {
      for (const info of nodes) {
        const b = info.bounds;
        let dx = 0;
        let dy = 0;
        if (edge === 'left') dx = left - b.x;
        else if (edge === 'right') dx = right - (b.x + b.w);
        else if (edge === 'hcenter') dx = (left + right) / 2 - (b.x + b.w / 2);
        else if (edge === 'top') dy = top - b.y;
        else if (edge === 'bottom') dy = bottom - (b.y + b.h);
        else dy = (top + bottom) / 2 - (b.y + b.h / 2);
        this.store.updateNode(info.id, (node) => ({
          transform: { ...node.transform, x: node.transform.x + dx, y: node.transform.y + dy },
        }));
      }
    });
  }

  /** Attach the selected nodes to the anchor of another node. */
  attachTo(childId: string, parentId: string, anchorId: string): void {
    const graph = this.getGraph();
    const child = graph.nodes.get(childId);
    const parent = graph.nodes.get(parentId);
    const anchor = parent?.anchors.find((a) => a.id === anchorId);
    if (!child || !parent || !anchor) return;
    this.store.updateNode(childId, {
      attachment: {
        parentId,
        anchorId,
        offset: { x: child.effective.x - anchor.pos.x, y: child.effective.y - anchor.pos.y },
      },
    });
  }

  detach(childId: string): void {
    const info = this.getGraph().nodes.get(childId);
    if (!info?.node.attachment) return;
    this.store.updateNode(childId, {
      attachment: undefined,
      transform: { ...info.node.transform, x: info.effective.x, y: info.effective.y },
    });
  }
}

/** Largest finite, positive grid step actually drawn (mirrors GridLayer's minor spacing). */
export function safeStep(size: number, subdivisions: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  const sub = Number.isFinite(subdivisions) && subdivisions >= 1 ? subdivisions : 1;
  const step = size / sub;
  return Number.isFinite(step) && step > 0 ? step : 0;
}

interface GuideCandidate {
  coord: number;
  sources: string[];
  delta: number;
}

function gatherGuideCandidates(
  probes: number[],
  tolerance: number,
  exclude: ReadonlySet<string>,
  query: (probe: number, tolerance: number, exclude: ReadonlySet<string>) => { coord: number; sources: string[]; delta: number }[],
): GuideCandidate[] {
  const byCoord = new Map<number, { sources: Set<string>; delta: number }>();
  for (const probe of probes) {
    for (const hit of query(probe, tolerance, exclude)) {
      const existing = byCoord.get(hit.coord);
      if (existing) {
        for (const source of hit.sources) existing.sources.add(source);
        if (Math.abs(hit.delta) < Math.abs(existing.delta)) existing.delta = hit.delta;
      } else {
        byCoord.set(hit.coord, { sources: new Set(hit.sources), delta: hit.delta });
      }
    }
  }
  return [...byCoord.entries()]
    .map(([coord, v]) => ({ coord, sources: [...v.sources], delta: v.delta }))
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
    .slice(0, GUIDE_CAP_PER_AXIS);
}

export interface AxisSnapChoice {
  value: number;
  primaryCoord: number | null;
}

/** True when `value` sits on the drawn grid lattice (within float tolerance). */
export function onLattice(value: number, step: number, origin: number): boolean {
  if (!(step > 0)) return true;
  return Math.abs(value - snapTo(value, step, origin)) <= step * 1e-6;
}

/**
 * Nearest alignment candidate that is actually usable. With snap-to-grid on we
 * skip candidates that would land the node between grid lines: aligning to an
 * off-lattice edge is how a single stray coordinate used to propagate across the
 * whole sheet.
 */
function pickAxisCandidate(
  candidates: GuideCandidate[],
  raw: number,
  gridActive: boolean,
  step: number,
  origin: number,
): GuideCandidate | null {
  if (!gridActive) return candidates[0] ?? null;
  return candidates.find((c) => onLattice(raw + c.delta, step, origin)) ?? null;
}

/** Picks between the nearest alignment guide and the grid, biasing towards alignment. */
export function chooseAxisSnap(
  raw: number,
  best: { coord: number; delta: number } | null,
  gridActive: boolean,
  step: number,
  origin: number,
  epsilon: number,
): AxisSnapChoice {
  const gridValue = gridActive ? snapTo(raw, step, origin) : raw;
  if (
    best &&
    (!gridActive ||
      (Math.abs(best.delta) <= Math.abs(gridValue - raw) + epsilon && onLattice(raw + best.delta, step, origin)))
  ) {
    return { value: raw + best.delta, primaryCoord: best.coord };
  }
  if (gridActive) return { value: gridValue, primaryCoord: null };
  return { value: raw, primaryCoord: null };
}

export { rectFromPoints };
