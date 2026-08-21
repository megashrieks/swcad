import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Rect, Vec } from '@core/geometry/index';
import { rectFromPoints, rectUnion } from '@core/geometry/index';
import { outlineAttach, outlinePath } from '@core/geometry/outline';
import type { Change } from '@core/model/store';
import { bindTarget } from '@core/model/bind';
import { resolveAnnotations } from '@core/model/annotations';
import { LINE_SPACING as MD_LINE_SPACING } from '@core/text/markdown';
import { measureVertical, measureWidth } from '@core/text/measure';
import type { ResolvedNodeInfo } from '@core/model/graph';
import { pickGroupMember, portGroupIds } from '@core/model/graph';
import type { Node } from '@core/model/types';
import type { ComponentEntry } from '@core/library/registry';
import type { EditorController, DragState, SnapResult, ToolId } from './EditorController';
import { GridLayer, HighlightLayer, RulerLayer } from './layers/CanvasLayers';
import {
  connectionMarkup,
  connectorInk,
  nodeMarkup,
  nodeTransform,
  previewMarkup,
  NODE_OUTLINE_PAD,
  type InkStroke,
} from './render';

export interface EditorSurfaceProps {
  controller: EditorController;
  /** World-space content drawn under the graph (page frame, component canvas). */
  underlay?: ReactNode;
  /** World-space content drawn above the graph. */
  overlay?: ReactNode;
  /**
   * Frame the drawing whenever this changes. The surface is the only thing that knows how
   * big it is, so "centre what was just opened" has to be asked for from out here rather
   * than done by the caller the moment it swaps the document.
   */
  fitKey?: unknown;
  /** Ceiling for the zoom an automatic fit may choose. */
  fitMaxZoom?: number;
}

/**
 * The font's own ascent and descent at a given size — the box a line of text occupies.
 *
 * A line box is centred on these metrics, not on the em size, so assuming a fixed
 * fraction of the box leaves the inline editor a couple of pixels off the label it
 * covers. Canvas reports the same metrics the layout engine uses.
 */
const fontMetrics = ((): ((font: string, fontSize: number) => { ascent: number; descent: number }) => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (font, fontSize) => {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = font;
      const m = ctx.measureText('Hxg');
      if (Number.isFinite(m.fontBoundingBoxAscent) && Number.isFinite(m.fontBoundingBoxDescent)) {
        return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
      }
    }
    return { ascent: fontSize * 0.8, descent: fontSize * 0.2 };
  };
})();

export function useController(controller: EditorController): number {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/**
 * A `<g>` filled from a markup string, rewritten only when that string actually changes.
 *
 * React assigns `innerHTML` unconditionally whenever the `dangerouslySetInnerHTML` prop is a
 * different *object*, and an inline `{{ __html }}` literal is a new object on every render.
 * That tore down and rebuilt every node's DOM on every render, which cost a full re-parse per
 * drag frame and — because Chromium drops a pending click when the pressed element leaves the
 * tree — meant no `click` or `dblclick` ever fired over a node. Memoising the prop keeps the
 * DOM in place while the drawing is unchanged.
 */
function RawGroup({ markup, ...rest }: { markup: string } & React.SVGProps<SVGGElement>): JSX.Element {
  const html = useMemo(() => ({ __html: markup }), [markup]);
  return <g {...rest} dangerouslySetInnerHTML={html} />;
}

/** Unmodified keys that pick a tool, as the toolbar's tooltips promise. */
const TOOL_KEYS: Record<string, ToolId> = { v: 'select', h: 'pan', c: 'connect' };

/** A zoom session ends once the user pauses this long between wheel notches. */
const ZOOM_SESSION_IDLE_MS = 600;/** …or moves the pointer further than this, which re-picks the zoom target. */
const ZOOM_SESSION_SLOP_PX = 3;

/** How far off a shape a click may land and still count as being on it, in screen pixels. */
const HIT_TOLERANCE = 6;
/** Unit offsets probed at that radius when the pointer itself is over bare canvas. */
const HIT_RING: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [0.707, 0.707],
  [-0.707, 0.707],
  [0.707, -0.707],
  [-0.707, -0.707],
];

const zoomFactor = (dy: number, perPixel: number): number =>
  Math.min(2, Math.max(0.5, Math.exp(-dy * perPixel)));

/**
 * Where the armed component would land, and the hints that go with it.
 *
 * The ghost, the guides and the click that drops the node all have to agree about the
 * position, and they run at different moments, so all three ask this rather than each
 * snapping for themselves. The box handed to `snap` is the component's own measured
 * drawing, not its instance box: a symbol may hang off its origin, and the gap the user
 * is judging is the one they can see.
 */
function ghostPlacement(
  controller: EditorController,
  world: Vec | null,
): { entry: ComponentEntry; markup: string; pos: Vec; box: Rect; snapped: SnapResult } | null {
  if (controller.tool !== 'place' || !controller.placeRef || !world) return null;
  const entry = controller.registry.get(controller.placeRef);
  if (!entry || entry.def.connector) return null;
  const { markup, box } = previewMarkup(entry, controller.registry);
  const at = { x: world.x + box.x, y: world.y + box.y, w: box.w, h: box.h };
  const snapped = controller.snap(world, [], { xs: [], ys: [] }, at);
  const pos = snapped.pos;
  return { entry, markup, pos, box: { x: pos.x + box.x, y: pos.y + box.y, w: box.w, h: box.h }, snapped };
}

/**
 * Both ends of the rubber-band line while connecting. Surface ports have no
 * fixed spot, so each end slides along its edge to face the other, and a port
 * that shares its name with others hops to whichever of them reads best — the
 * same choice the engine makes once the connection is committed.
 */
function connectPreview(controller: EditorController, drag: DragState): { a: Vec; b: Vec } {
  const graph = controller.getGraph();
  const from = drag.from;
  const sourceNode = from?.kind === 'port' ? graph.nodes.get(from.nodeId) : undefined;
  const stored = from?.kind === 'port' ? sourceNode?.ports.find((p) => p.id === from.portId) : undefined;
  const hovered = drag.hoverPort;
  const grid = controller.attachGrid();
  const aim = hovered ? hovered.pos : drag.current;
  const source = sourceNode && stored ? pickGroupMember(sourceNode, stored, aim, grid) : stored;
  let a = source && source.id !== stored?.id ? source.pos : (drag.fromPos ?? drag.start);
  if (source?.outline) a = outlineAttach(source.outline, aim, grid).pos;
  const targetNode = hovered ? graph.nodes.get(hovered.nodeId) : undefined;
  const target = targetNode && hovered ? pickGroupMember(targetNode, hovered, a, grid) : hovered;
  let b = target ? controller.portAttach(target, a) : drag.current;
  if (source?.outline) a = outlineAttach(source.outline, b, grid).pos;
  return { a, b };
}

export function EditorSurface({ controller, underlay, overlay, fitKey, fitMaxZoom }: EditorSurfaceProps): JSX.Element {
  useController(controller);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const spaceRef = useRef(false);
  // Where the placement ghost last sat, so a pointer move only forces a repaint once the
  // ghost would actually move — with snapping on that is once per grid cell, not per pixel.
  const ghostRef = useRef<Vec | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (): void => {
      const box = host.getBoundingClientRect();
      const next = { w: box.width, h: box.height };
      const prev = controller.viewSize;
      controller.viewSize = next;
      // A pane that grows or shrinks keeps whatever was in the middle of it in the middle
      // of it, rather than pinning the drawing to the top-left and letting it drift.
      if (prev.w > 0 && prev.h > 0 && (prev.w !== next.w || prev.h !== next.h)) {
        controller.panBy((next.w - prev.w) / 2, (next.h - prev.h) / 2);
      }
      setSize(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, [controller]);

  // The zoom ceiling belongs to the canvas, not to one call, so that the toolbar's Fit
  // frames a component exactly the way opening it did. Set before the fit effect below.
  useLayoutEffect(() => {
    if (fitMaxZoom !== undefined) controller.fitMaxZoom = fitMaxZoom;
  }, [controller, fitMaxZoom]);

  // Framing what has just been opened has to wait for a measured surface and a graph the
  // engine has already laid out, so it happens a frame late rather than on the spot. The
  // live `viewSize` is read at that point; `size` is here only to retry once it lands.
  //
  // The frame is never cancelled on teardown. Whether a key has been framed is remembered
  // on the controller, so it survives both the re-run that the first measurement causes
  // and StrictMode's remount — cancelling would drop the only fit that was ever going to
  // be scheduled. A frame that outlives the surface just re-centres a controller nothing
  // is looking at.
  const fitFrame = useRef(0);
  useEffect(() => {
    if (fitKey === undefined || fitKey === controller.framedKey) return;
    if (controller.viewSize.w <= 0 || controller.viewSize.h <= 0) return;
    controller.framedKey = fitKey;
    cancelAnimationFrame(fitFrame.current);
    fitFrame.current = requestAnimationFrame(() => {
      // Measured again here, not reused from above: opening a component can bring the
      // inspector pane in with it, and that narrows the surface after the effect ran.
      const box = hostRef.current?.getBoundingClientRect();
      const now = box ? { w: box.width, h: box.height } : controller.viewSize;
      controller.viewSize = now;
      controller.fit(now);
    });
  }, [fitKey, size, controller]);

  const doc = controller.store.getDocument();
  const graph = controller.getGraph();
  const { viewport } = controller;

  const pointerPos = useCallback(
    (event: { clientX: number; clientY: number }): Vec => {
      const box = hostRef.current?.getBoundingClientRect();
      return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
    },
    [],
  );

  // ------------------------------------------------------------ hit testing

  /**
   * What is actually drawn under the pointer, or null for bare canvas.
   *
   * Selection follows the drawing, never the box around it: the browser has already hit-tested
   * the SVG we painted — through every rotation, scale, fill rule and stacking decision — so we
   * ask it rather than re-deriving the answer from bounds. That makes the empty middle of an
   * open shape click *through* to whatever sits behind it, and it makes a click on a shape mean
   * that shape, which is what the inspector then shows.
   *
   * The ring of extra probes is the tolerance a bounding box used to provide by accident:
   * without it a hairline or a thin glyph would need pixel-perfect aim. The centre is tried
   * first and alone in the common case, so a hit costs one call.
   */
  const pickAt = useCallback((clientX: number, clientY: number): { kind: 'node' | 'connection'; id: string } | null => {
    const root = hostRef.current;
    if (!root) return null;
    const probe = (x: number, y: number): { kind: 'node' | 'connection'; id: string } | null => {
      // Topmost first, and every ancestor of each hit, so the first match is the frontmost
      // node or connection. Overlays without a data id are stepped over rather than blocking.
      for (const el of document.elementsFromPoint(x, y)) {
        const owner = el.closest?.('[data-node],[data-connection]');
        if (!owner || !root.contains(owner)) continue;
        const nodeId = owner.getAttribute('data-node');
        if (nodeId) return { kind: 'node', id: nodeId };
        const connectionId = owner.getAttribute('data-connection');
        if (connectionId) return { kind: 'connection', id: connectionId };
      }
      return null;
    };
    const direct = probe(clientX, clientY);
    if (direct) return direct;
    for (const [dx, dy] of HIT_RING) {
      const near = probe(clientX + dx * HIT_TOLERANCE, clientY + dy * HIT_TOLERANCE);
      if (near) return near;
    }
    return null;
  }, []);

  // ------------------------------------------------------------ interaction

  const beginDrag = (state: DragState): void => {
    controller.drag = state;
    controller.notify();
  };

  const originsFor = (ids: string[]): DragState['origin'] => {
    const map: DragState['origin'] = new Map();
    for (const id of ids) {
      const node = controller.store.getDocument().nodes[id];
      if (node) map.set(id, { transform: { x: node.transform.x, y: node.transform.y }, size: { ...node.size } });
    }
    return map;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const screen = pointerPos(event);
    const world = controller.toWorld(screen);
    const panning = event.button === 1 || spaceRef.current || controller.tool === 'pan';

    if (panning) {
      beginDrag({ kind: 'pan', start: screen, current: screen, nodeIds: [], origin: new Map(), moved: false });
      return;
    }
    if (event.button !== 0) return;

    if (controller.tool === 'place' && (controller.placeRef || controller.onPlace)) {
      const placement = ghostPlacement(controller, world);
      const snapped = placement?.snapped ?? controller.snap(world);
      if (controller.placeRef) {
        const node = controller.createNode(controller.placeRef, snapped.pos);
        if (node) controller.select([node.id]);
      } else {
        controller.onPlace?.(snapped.pos, event.shiftKey);
      }
      if (!event.shiftKey) {
        controller.tool = 'select';
        controller.placeRef = null;
        controller.onPlace = null;
      }
      controller.guides = [];
      controller.measures = [];
      controller.notify();
      return;
    }

    const handle = controller.handleAt(world);
    if (handle && controller.tool === 'select') {
      const info = graph.nodes.get(handle.nodeId);
      const grip = info?.handles.find((h) => h.id === handle.handleId);
      beginDrag({
        kind: 'resize',
        start: world,
        current: world,
        nodeIds: [handle.nodeId],
        origin: originsFor([handle.nodeId]),
        handleId: handle.handleId,
        sizeOffset:
          info && grip
            ? {
                x: info.node.size.w - (grip.pos.x - info.effective.x),
                y: info.node.size.h - (grip.pos.y - info.effective.y),
              }
            : { x: 0, y: 0 },
        moved: false,
      });
      return;
    }

    // Outline ports cover a whole shape edge, so in select mode they must not
    // steal the click that drags the node; the connect tool opts back in.
    const port = controller.portAt(world, controller.tool === 'connect');
    if (port && (controller.tool === 'select' || controller.tool === 'connect')) {
      beginDrag({
        kind: 'connect',
        start: world,
        current: world,
        nodeIds: [],
        origin: new Map(),
        from: { kind: 'port', nodeId: port.nodeId, portId: port.id },
        fromPos: port.pos,
        moved: false,
      });
      return;
    }

    const hit = pickAt(event.clientX, event.clientY);
    if (hit) {
      if (event.shiftKey) controller.toggleSelect(hit.id);
      else if (!controller.selection.has(hit.id)) controller.select([hit.id]);

      if (controller.tool === 'connect' && hit.kind === 'node') {
        const info = graph.nodes.get(hit.id);
        const nearest = nearestPort(info?.ports ?? [], world);
        if (nearest) {
          beginDrag({
            kind: 'connect',
            start: world,
            current: world,
            nodeIds: [],
            origin: new Map(),
            from: { kind: 'port', nodeId: nearest.nodeId, portId: nearest.id },
            fromPos: nearest.pos,
            moved: false,
          });
          return;
        }
      }

      const ids = [...controller.selection].filter((id) => controller.store.getDocument().nodes[id]);
      if (ids.length > 0) {
        beginDrag({ kind: 'move', start: world, current: world, nodeIds: ids, origin: originsFor(ids), moved: false });
      }
      return;
    }

    if (!event.shiftKey) controller.clearSelection();
    beginDrag({ kind: 'marquee', start: world, current: world, nodeIds: [], origin: new Map(), moved: false });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const screen = pointerPos(event);
    const world = controller.toWorld(screen);
    const drag = controller.drag;
    controller.cursorWorld = world;

    if (!drag) {
      const port = controller.portAt(world, controller.tool === 'connect');
      const hit = port ? null : pickAt(event.clientX, event.clientY);
      const nextHover = hit?.id ?? null;
      let changed = nextHover !== controller.hoverId || port?.id !== controller.hoverPort?.id;
      controller.hoverId = nextHover;
      controller.hoverPort = port;

      // The ghost carries the same hints a move drag gets: what it lines up with, and
      // which of its gaps repeat one already on the sheet.
      const placement = ghostPlacement(controller, world);
      const ghost = placement?.pos ?? null;
      if (ghost?.x !== ghostRef.current?.x || ghost?.y !== ghostRef.current?.y) {
        ghostRef.current = ghost;
        changed = true;
      }
      controller.guides = placement?.snapped.guides ?? [];
      controller.measures = placement?.snapped.measures ?? [];

      if (changed) controller.notify();
      return;
    }

    if (drag.kind === 'pan') {
      controller.panBy(screen.x - drag.current.x, screen.y - drag.current.y);
      drag.current = screen;
      drag.moved = true;
      return;
    }

    drag.current = world;
    drag.moved = true;

    if (drag.kind === 'move') {
      const dx = world.x - drag.start.x;
      const dy = world.y - drag.start.y;
      const lead = drag.nodeIds[0];
      const leadOrigin = drag.origin.get(lead);
      const leadInfo = graph.nodes.get(lead);
      let adjustX = dx;
      let adjustY = dy;

      if (leadOrigin && leadInfo) {
        // `leadInfo` describes the node where it sits *now*, part way through the drag,
        // while `dx/dy` is measured from where the drag began. Mixing the two counts the
        // distance already travelled twice, which sends the probes and the spacing search
        // off to somewhere the node has never been. What they do share is the node's
        // transform, so the geometry is carried over as an offset from it.
        const target = { x: leadOrigin.transform.x + dx, y: leadOrigin.transform.y + dy };
        const shiftX = target.x - leadInfo.node.transform.x;
        const shiftY = target.y - leadInfo.node.transform.y;
        // Every dragged node travels by the same delta, so one shift carries the whole
        // selection, and a group lines up and spaces itself by its outline — what you see
        // being dragged — rather than by whichever node the pointer happened to grab.
        const moving: ResolvedNodeInfo[] = [];
        for (const id of drag.nodeIds) {
          const info = graph.nodes.get(id);
          if (info) moving.push(info);
        }
        const shift = (r: Rect): Rect => ({ x: r.x + shiftX, y: r.y + shiftY, w: r.w, h: r.h });
        const box = shift(moving.reduce((acc, i) => rectUnion(acc, i.bounds), moving[0].bounds));
        // Edges and centre come from the painted box, which is what the rest of the sheet
        // publishes to line up with — probing with the bounds instead would offer a caption's
        // edge to a drawing that never advertises one.
        const a = shift(moving.reduce((acc, i) => rectUnion(acc, i.alignBox), moving[0].alignBox));
        const ports = moving.flatMap((i) => i.ports);
        const probes = {
          xs: [a.x, a.x + a.w / 2, a.x + a.w, ...ports.map((p) => p.pos.x + shiftX)],
          ys: [a.y, a.y + a.h / 2, a.y + a.h, ...ports.map((p) => p.pos.y + shiftY)],
        };
        const snapped = controller.snap(target, drag.nodeIds, probes, box);
        adjustX = dx + (snapped.pos.x - target.x);
        adjustY = dy + (snapped.pos.y - target.y);
        controller.guides = snapped.guides;
        controller.measures = snapped.measures;
      }

      controller.store.silent(() => {
        for (const id of drag.nodeIds) {
          const origin = drag.origin.get(id);
          if (!origin) continue;
          controller.store.updateNode(id, (node) => ({
            transform: { ...node.transform, x: origin.transform.x + adjustX, y: origin.transform.y + adjustY },
          }));
        }
      });
      controller.notify();
      return;
    }

    if (drag.kind === 'resize') {
      const id = drag.nodeIds[0];
      const origin = drag.origin.get(id);
      const info = graph.nodes.get(id);
      if (origin && info) {
        const snapped = controller.snap(world, drag.nodeIds);
        const offset = drag.sizeOffset ?? { x: 0, y: 0 };
        const w = Math.max(20, snapped.pos.x - info.effective.x + offset.x);
        const h = Math.max(20, snapped.pos.y - info.effective.y + offset.y);
        controller.guides = snapped.guides;
        controller.measures = snapped.measures;
        controller.store.silent(() => {
          controller.store.updateNode(id, { size: { w, h } });
        });
      }
      controller.notify();
      return;
    }

    if (drag.kind === 'connect') {
      const port = controller.portAt(world);
      drag.hoverPort = port;
      const snapped = controller.snap(world);
      controller.guides = snapped.guides;
      controller.measures = snapped.measures;
      controller.notify();
      return;
    }

    controller.notify();
  };

  const onPointerLeave = (): void => {
    // Nothing is under the pointer once it leaves the sheet, so drop the hover state that
    // keeps port markers and the placement ghost alive.
    if (controller.drag) return;
    ghostRef.current = null;
    controller.guides = [];
    controller.measures = [];
    if (controller.cursorWorld === null && controller.hoverPort === null && controller.hoverId === null) return;
    controller.cursorWorld = null;
    controller.hoverPort = null;
    controller.hoverId = null;
    controller.notify();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = controller.drag;
    controller.drag = null;
    controller.guides = [];
    controller.measures = [];
    if (!drag) {
      controller.notify();
      return;
    }

    if (drag.kind === 'move' || drag.kind === 'resize') {
      const changes: Change[] = [];
      for (const [id, origin] of drag.origin) {
        const after = controller.store.getDocument().nodes[id];
        if (!after) continue;
        const before: Node = {
          ...after,
          transform: { ...after.transform, ...origin.transform },
          size: { ...origin.size },
        };
        if (before.transform.x !== after.transform.x || before.transform.y !== after.transform.y || before.size.w !== after.size.w || before.size.h !== after.size.h) {
          changes.push({ target: 'node', id, before, after });
        }
      }
      controller.store.pushHistory(drag.kind === 'move' ? 'move' : 'resize', changes);
    }

    if (drag.kind === 'marquee' && drag.moved) {
      const rect = rectFromPoints(drag.start, drag.current);
      controller.select(controller.nodesIn(rect), event.shiftKey);
    }

    if (drag.kind === 'connect' && drag.from) {
      const target = controller.portAt(drag.current);
      // Members of one same-named group are the same logical port, so dropping on a
      // sibling of the port we started from is still a self-connection.
      const sameLogicalPort =
        !!target &&
        drag.from.kind === 'port' &&
        target.nodeId === drag.from.nodeId &&
        portGroupIds(graph.nodes.get(target.nodeId), drag.from.portId).includes(target.id);
      if (target && !sameLogicalPort) {
        controller.connect(drag.from, { kind: 'port', nodeId: target.nodeId, portId: target.id });
      } else if (drag.moved) {
        const snapped = controller.snap(drag.current);
        controller.connect(drag.from, { kind: 'free', x: snapped.pos.x, y: snapped.pos.y });
      }
    }

    controller.notify();
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const world = controller.toWorld(pointerPos(event));
    const hit = pickAt(event.clientX, event.clientY);
    if (!hit || hit.kind !== 'node') return;
    const info = graph.nodes.get(hit.id);
    if (!info) return;
    const editable = resolveAnnotations(info.def, info.node.params)
      .filter(([, ann]) => ann.kind === 'label' && ann.editable)
      .map(([elId]) => elId);
    if (editable.length === 0) return;
    controller.editingLabel = { nodeId: hit.id, elementId: pickLabel(info, editable, world) };
    controller.notify();
  };

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const zoomSessionRef = useRef<{ x: number; y: number; at: number } | null>(null);

  // Native, non-passive listener: React's onWheel is passive, so preventDefault()
  // there is a no-op and the page/browser would still scroll or pinch-zoom.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const LINE_HEIGHT_PX = 16;
    const ZOOM_PER_PIXEL = 0.0015;
    const onWheelNative = (event: WheelEvent): void => {
      event.preventDefault();
      const box = host.getBoundingClientRect();
      const screen = { x: event.clientX - box.left, y: event.clientY - box.top };
      const scale = event.deltaMode === 1 ? LINE_HEIGHT_PX : event.deltaMode === 2 ? sizeRef.current.h : 1;
      const dx = event.deltaX * scale;
      const dy = event.deltaY * scale;
      const ctrl = controllerRef.current;

      // Shift turns the wheel into a horizontal pan for mice with no deltaX.
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        ctrl.panBy(-(dx + dy), 0);
        zoomSessionRef.current = null;
        return;
      }

      // Ctrl/cmd + wheel is the pinch gesture: zoom straight about the cursor,
      // with no recentring jump.
      if (event.ctrlKey || event.metaKey) {
        zoomSessionRef.current = null;
        if (dy !== 0) ctrl.zoomAt(screen, zoomFactor(dy, ZOOM_PER_PIXEL));
        if (dx !== 0) ctrl.panBy(-dx, 0);
        return;
      }

      // Plain vertical wheel zooms KiCad-style: the first notch of a session
      // warps the point under the cursor to the middle of the view, and the
      // rest of the session zooms about that middle. A session ends when the
      // pointer moves or the user pauses.
      if (dy !== 0) {
        const { w, h } = sizeRef.current;
        const centre = w > 0 && h > 0 ? { x: w / 2, y: h / 2 } : screen;
        const now = event.timeStamp || performance.now();
        const session = zoomSessionRef.current;
        const continuing =
          session !== null &&
          now - session.at <= ZOOM_SESSION_IDLE_MS &&
          Math.abs(screen.x - session.x) <= ZOOM_SESSION_SLOP_PX &&
          Math.abs(screen.y - session.y) <= ZOOM_SESSION_SLOP_PX;

        if (!continuing) ctrl.recenter(screen, centre);
        zoomSessionRef.current = { x: screen.x, y: screen.y, at: now };
        ctrl.zoomAt(centre, zoomFactor(dy, ZOOM_PER_PIXEL));
      }
      if (dx !== 0) ctrl.panBy(-dx, 0);
    };
    host.addEventListener('wheel', onWheelNative, { passive: false });
    return () => host.removeEventListener('wheel', onWheelNative);
  }, []);

  // -------------------------------------------------------------- shortcuts

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spaceRef.current = true;
      if (isTyping(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) controller.store.redo();
        else controller.store.undo();
        controller.invalidateGraph();
        controller.notify();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        controller.store.redo();
        controller.invalidateGraph();
        controller.notify();
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        controller.selectAll();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        controller.duplicateSelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        controller.copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        controller.cutSelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        void controller.readClipboard().then((payload) => {
          if (payload) controller.pasteClipboard(payload);
        });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controller.deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        controller.tool = 'select';
        controller.placeRef = null;
        controller.onPlace = null;
        controller.drag = null;
        controller.editingLabel = null;
        controller.clearSelection();
        controller.notify();
        return;
      }
      // Zoom to fit. `F` sits with the other unmodified letter shortcuts; Shift+1 is the
      // one most users arrive with, matched on `code` so a non-US layout still reaches it.
      if (
        (event.key.toLowerCase() === 'f' && !mod && !event.altKey && !event.shiftKey) ||
        (event.code === 'Digit1' && event.shiftKey && !mod && !event.altKey)
      ) {
        event.preventDefault();
        controller.fit();
        return;
      }
      // The tool shortcuts the toolbar advertises. Unmodified letters only, so Ctrl+C and
      // friends above have already had their turn.
      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (tool && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        controller.tool = tool;
        controller.placeRef = null;
        controller.onPlace = null;
        controller.notify();
        return;
      }
      const step = event.shiftKey ? doc.grid.size : doc.grid.size / doc.grid.subdivisions;
      const nudge = (dx: number, dy: number): void => {
        controller.nudge(dx, dy);
      };
      if (event.key === 'ArrowLeft') nudge(-step, 0);
      else if (event.key === 'ArrowRight') nudge(step, 0);
      else if (event.key === 'ArrowUp') nudge(0, -step);
      else if (event.key === 'ArrowDown') nudge(0, step);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [controller, doc.grid.size, doc.grid.subdivisions]);

  // ----------------------------------------------------------------- render

  const drag = controller.drag;
  const highlightActive = Boolean(drag && (drag.kind === 'move' || drag.kind === 'connect' || drag.kind === 'resize')) || controller.tool === 'place';

  const page = doc.page;
  const pageBox = useMemo(
    () => (page ? { x: 0, y: 0, w: page.width * page.scale, h: page.height * page.scale } : null),
    [page],
  );

  // What the guides have to stay out of. A connection is described by the line it draws
  // rather than by its box: an orthogonal route claims the whole detour it makes, and
  // punching that out would cut a hole the size of the bend. Its captions are boxes, and
  // they are the part a guide most obviously spoils.
  // The placement ghost counts as drawn — a guide crossing it would read as a line through
  // the component about to be dropped.
  const placement = drag ? null : ghostPlacement(controller, controller.cursorWorld);  const ghostBox = placement?.box ?? null;
  const ghostKey = ghostBox ? `${ghostBox.x} ${ghostBox.y} ${ghostBox.w} ${ghostBox.h}` : '';
  const { obstacles, ink } = useMemo(() => {
    const boxes = graph.order.map((id) => graph.nodes.get(id)?.bounds).filter((b): b is Rect => b !== undefined);
    const strokes: InkStroke[] = [];
    for (const id of graph.connectionOrder) {
      const info = graph.connections.get(id);
      if (!info) continue;
      const drawn = connectorInk(info);
      strokes.push(...drawn.strokes);
      boxes.push(...drawn.boxes);
    }
    if (ghostBox) boxes.push(ghostBox);
    return { obstacles: boxes, ink: strokes };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ghostKey stands in for ghostBox
  }, [graph, ghostKey]);

  // What the selection spans, marked out on the rulers so the gutters read the drawing and
  // not just the viewport. Folded over the selection on every render — which is what the
  // selection changing and a drag both cause anyway — rather than over the sheet.
  let selectionExtent: Rect | null = null;
  for (const id of controller.selection) {
    const info = graph.nodes.get(id) ?? graph.connections.get(id);
    if (!info) continue;
    selectionExtent = selectionExtent ? rectUnion(selectionExtent, info.bounds) : info.bounds;
  }

  return (
    <>
      {controller.showRulers ? (
        <RulerLayer grid={doc.grid} viewport={viewport} size={size} extent={selectionExtent} />
      ) : null}
      <div
        ref={hostRef}
        className={`surface tool-${controller.tool}${controller.showRulers ? ' has-rulers' : ''}${!drag && controller.hoverPort ? ' hover-port' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <GridLayer grid={doc.grid} viewport={viewport} size={size} page={pageBox} />
        <HighlightLayer
          viewport={viewport}
          size={size}
          guides={controller.guides}
          measures={controller.measures}
          obstacles={obstacles}
          ink={ink}
          active={highlightActive}
        />

        <svg className="layer content" width={size.w} height={size.h}>
          <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.zoom})`}>
            {underlay}

            {graph.connectionOrder.map((id) => {
              const info = graph.connections.get(id)!;
              return (
                <RawGroup
                  key={id}
                  data-connection={id}
                  className={`connection${controller.selection.has(id) ? ' is-selected' : ''}`}
                  markup={connectionMarkup(info)}
                />
              );
            })}

            {graph.order.map((id) => {
              const info = graph.nodes.get(id)!;
              if (info.node.hidden) return null;
              const editingHere = controller.editingLabel?.nodeId === id ? controller.editingLabel.elementId : null;
              return (
                <RawGroup
                  key={id}
                  data-node={id}
                  className={`node${controller.selection.has(id) ? ' is-selected' : ''}${controller.hoverId === id ? ' is-hover' : ''}`}
                  transform={nodeTransform(info)}
                  markup={nodeMarkup(info, editingHere)}
                />
              );
            })}

            {/* selection outlines */}
            {(controller.showNodeOutline ? [...controller.selection] : []).map((id) => {
              const info = graph.nodes.get(id) ?? graph.connections.get(id);
              if (!info) return null;
              const b = info.bounds;
              return (
                <rect
                  key={`sel-${id}`}
                  className="selection-outline"
                  x={b.x - NODE_OUTLINE_PAD}
                  y={b.y - NODE_OUTLINE_PAD}
                  width={b.w + NODE_OUTLINE_PAD * 2}
                  height={b.h + NODE_OUTLINE_PAD * 2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* resize handles */}
            {controller.selectedNodes().flatMap((info) =>
              info.handles.map((handle) => (
                <rect
                  key={`h-${info.id}-${handle.id}`}
                  className="handle"
                  x={handle.pos.x - 4 / viewport.zoom}
                  y={handle.pos.y - 4 / viewport.zoom}
                  width={8 / viewport.zoom}
                  height={8 / viewport.zoom}
                />
              )),
            )}

            {/* port markers: a node shows its ports while the pointer is inside its bounds (or
                while a connector is being dragged into them); otherwise only the port under the
                pointer is drawn, so the sheet stays quiet. The component editor reveals them all. */}
            {(() => {
              const connecting = controller.tool === 'connect' || drag?.kind === 'connect';
              const reveal = controller.revealAnnotations;
              const showAll = connecting || controller.showPorts;
              // Only the tools that can start a connector get the hover affordance.
              const canGrab = controller.tool === 'select' || controller.tool === 'connect';
              const hover = drag || !canGrab ? null : controller.hoverPort;
              if (!showAll && !hover && !reveal) return null;
              const cursor = controller.cursorWorld;
              // Reach matches the port pick radius, so a port sitting on the border is visible
              // wherever it can still be grabbed.
              const reach = 10 / viewport.zoom;
              const withinBounds = (b: Rect): boolean =>
                cursor !== null &&
                cursor.x >= b.x - reach &&
                cursor.x <= b.x + b.w + reach &&
                cursor.y >= b.y - reach &&
                cursor.y <= b.y + b.h + reach;
              return [...graph.nodes.values()].flatMap((info) => {
                const near = reveal || withinBounds(info.bounds);
                return info.ports.flatMap((port) => {
                  const active =
                    drag?.kind === 'connect' && drag.hoverPort?.id === port.id && drag.hoverPort?.nodeId === port.nodeId;
                  const hovered = hover?.id === port.id && hover?.nodeId === port.nodeId;
                  if (!hovered && !active && !(showAll && near)) return [];
                  const emphasis = active || hovered;
                  if (port.outline) {
                    // A surface port is a whole stroke, so it is only drawn while connecting or
                    // while the pointer is on it; otherwise every node would read as highlighted.
                    if (!reveal && !connecting && !hovered) return [];
                    const aim = active && drag?.kind === 'connect' && drag.fromPos ? drag.fromPos : controller.cursorWorld;
                    const touch = emphasis && aim ? outlineAttach(port.outline, aim, controller.attachGrid()).pos : null;
                    return [
                      <g key={`port-${info.id}-${port.id}`}>
                        <path
                          className={`port-outline${active ? ' is-active' : ''}${hovered ? ' is-hover' : ''}${port.connected ? ' is-connected' : ''}`}
                          d={outlinePath(port.outline)}
                          vectorEffect="non-scaling-stroke"
                        />
                        {touch && (
                          <circle
                            className={`port-marker is-surface${active ? ' is-active' : ''}${hovered ? ' is-hover' : ''}`}
                            cx={touch.x}
                            cy={touch.y}
                            r={5 / viewport.zoom}
                          />
                        )}
                      </g>,
                    ];
                  }
                  return [
                    <circle
                      key={`port-${info.id}-${port.id}`}
                      className={`port-marker${active ? ' is-active' : ''}${hovered ? ' is-hover' : ''}${port.connected ? ' is-connected' : ''}`}
                      cx={port.pos.x}
                      cy={port.pos.y}
                      r={(emphasis ? 7 : 5) / viewport.zoom}
                    />,
                  ];
                });
              });
            })()}

            {/* anchors: attachment points of the selected nodes, or of every node when the
                component editor is showing what the annotations declare */}
            {(controller.revealAnnotations ? [...graph.nodes.values()] : controller.selectedNodes()).flatMap((info) =>
              info.anchors.map((anchor) => (
                <rect
                  key={`anchor-${info.id}-${anchor.id}`}
                  className="anchor-marker"
                  x={anchor.pos.x - 3 / viewport.zoom}
                  y={anchor.pos.y - 3 / viewport.zoom}
                  width={6 / viewport.zoom}
                  height={6 / viewport.zoom}
                />
              )),
            )}

            {drag?.kind === 'marquee' && drag.moved && (
              <rect
                className="marquee"
                {...toRectProps(drag.start, drag.current)}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {drag?.kind === 'connect' && drag.fromPos && (() => {
              const line = connectPreview(controller, drag);
              return (
                <line
                  className="connect-preview"
                  x1={line.a.x}
                  y1={line.a.y}
                  x2={line.b.x}
                  y2={line.b.y}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()}

            {/*
              The placement ghost: what is about to be dropped, drawn where it would land.
              An armed component is otherwise invisible on the canvas — the only sign is a lit
              palette tile — so a click is a guess about both what and where. It is the real
              drawing at the real snapped position rather than a box, because the two differ:
              a component may hang around its origin instead of filling its instance box.
            */}
            {!drag && controller.tool === 'place' && controller.placeRef
              ? (() => {
                  if (!placement) return null;
                  return (
                    <RawGroup
                      className="place-ghost"
                      transform={`translate(${placement.pos.x} ${placement.pos.y})`}
                      markup={placement.markup}
                    />
                  );
                })()
              : null}

            {overlay}
          </g>
        </svg>

        <LabelEditor controller={controller} surfaceSize={size} />
      </div>
    </>
  );
}

function toRectProps(a: Vec, b: Vec): { x: number; y: number; width: number; height: number } {
  const r = rectFromPoints(a, b);
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}

function nearestPort<T extends { pos: Vec }>(ports: T[], world: Vec): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const port of ports) {
    const d = Math.hypot(port.pos.x - world.x, port.pos.y - world.y);
    if (d < bestDist) {
      best = port;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Which editable label did the user double-click? Components like the title block carry
 * several, so picking the first one in the table would only ever edit the title.
 * The label box containing the point wins; otherwise the nearest one does.
 */
function pickLabel(info: ResolvedNodeInfo, candidates: string[], world: Vec): string {
  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const elId of candidates) {
    const box = info.labelBoxes?.[elId];
    if (!box) continue;
    const dx = Math.max(box.x - world.x, 0, world.x - (box.x + box.w));
    const dy = Math.max(box.y - world.y, 0, world.y - (box.y + box.h));
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = elId;
    }
  }
  return best;
}

function LabelEditor({
  controller,
  surfaceSize,
}: {
  controller: EditorController;
  surfaceSize: { w: number; h: number };
}): JSX.Element | null {
  const editing = controller.editingLabel;
  const graph = controller.getGraph();
  const info = editing ? graph.nodes.get(editing.nodeId) : null;
  const annotation =
    editing && info
      ? (resolveAnnotations(info.def, info.node.params).find(
          ([elId, ann]) => elId === editing.elementId && ann.kind === 'label',
        )?.[1] ?? null)
      : null;
  const [value, setValue] = useState('');

  useEffect(() => {
    if (editing && info) setValue(info.labels[editing.elementId] ?? '');
  }, [editing?.nodeId, editing?.elementId]);

  if (!editing || !info || !annotation || annotation.kind !== 'label') return null;

  const bindPath = bindTarget(annotation.bind);
  const commit = (): void => {
    if (bindPath.startsWith('params.')) {
      const key = bindPath.slice('params.'.length);
      controller.store.updateNode(editing.nodeId, (node) => ({ params: { ...node.params, [key]: value } }));
    } else if (bindPath.startsWith('meta.')) {
      controller.store.setMeta({ [bindPath.slice('meta.'.length)]: value });
    }
    controller.editingLabel = null;
    controller.notify();
  };

  const zoom = controller.viewport.zoom;
  const labelBox = info.labelBoxes?.[editing.elementId];
  const style = info.labelStyles?.[editing.elementId];
  // A `style` hook can restyle a label; its values are local, so lift them the same way.
  const override = info.styles?.[editing.elementId];
  const overrideSize = Number(override?.['font-size']);
  const fontSize =
    (Number.isFinite(overrideSize) ? overrideSize * info.effective.scale : (style?.fontSize ?? 14)) * zoom;
  const align =
    style?.anchor === 'middle' || annotation.align === 'center'
      ? 'center'
      : style?.anchor === 'end' || annotation.align === 'end'
        ? 'right'
        : 'left';
  const fontFamily = override?.['font-family'] ?? style?.fontFamily;
  const fontWeight = override?.['font-weight'] ?? style?.fontWeight;
  const fontStyle = override?.['font-style'] ?? style?.fontStyle;

  // Markdown is a block, not a word: it is typed as source over the box the rendered
  // result occupies, and Enter is a line break rather than "done".
  if (annotation.markdown) {
    const lines = value.split('\n');
    // Sized from the source, not from the rendered block: a heading draws much wider than
    // the `# ` that produced it, and a box sized for the drawing would be clamped away
    // from the text it is meant to sit on.
    const spec = {
      family: fontFamily ?? 'sans-serif',
      size: fontSize,
      weight: String(fontWeight ?? 400),
      style: fontStyle ?? 'normal',
      letterSpacing: 0,
    };
    const metrics = measureVertical(spec);
    const lineHeight = fontSize * MD_LINE_SPACING;
    const width = Math.max(...lines.map((line) => measureWidth(line, spec)), fontSize * 4) + fontSize * 0.6;
    const height = lines.length * lineHeight + metrics.descent;
    const corner = labelBox
      ? controller.toScreen({ x: labelBox.x, y: labelBox.y })
      : controller.toScreen({ x: info.bounds.x, y: info.bounds.y });
    // A laid-out block puts its first baseline one ascent below its top, while a textarea
    // centres the font box in the line box first. Lift by the difference so the source
    // starts on the same line the drawn text did.
    const lead = (lineHeight - (metrics.ascent + metrics.descent)) / 2;
    return (
      <textarea
        className="label-editor is-markdown"
        autoFocus
        value={value}
        spellCheck={false}
        style={{
          left: Math.min(Math.max(0, corner.x), Math.max(0, surfaceSize.w - width)),
          top: Math.min(Math.max(0, corner.y - lead), Math.max(0, surfaceSize.h - height)),
          width,
          height,
          fontSize,
          fontFamily,
          fontWeight,
          fontStyle,
          color: override?.fill ?? style?.color,
          lineHeight: `${lineHeight}px`,
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
          if (e.key === 'Escape') {
            controller.editingLabel = null;
            controller.notify();
          }
        }}
      />
    );
  }

  // Match the drawn text: same font, same size, same baseline — then grow as the user types.
  const typedWidth = Math.max(value.length + 1, 4) * fontSize * 0.58;
  const width = Math.max(labelBox ? labelBox.w * zoom : 0, typedWidth);
  const metrics = fontMetrics(
    `${fontStyle ?? 'normal'} ${fontWeight ?? 400} ${fontSize}px ${fontFamily ?? 'sans-serif'}`,
    fontSize,
  );
  // The full font box, so the caret and any descenders have room even on a short label.
  const height = Math.max(labelBox ? labelBox.h * zoom : 0, metrics.ascent + metrics.descent);
  const anchor = labelBox
    ? controller.toScreen({
        x: labelBox.x + (align === 'center' ? labelBox.w / 2 : align === 'right' ? labelBox.w : 0),
        y: labelBox.y,
      })
    : (() => {
        const fallback = controller.toScreen({ x: info.bounds.x, y: info.bounds.y });
        return { x: fallback.x, y: fallback.y - 28 };
      })();
  const anchorLeft = anchor.x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);

  // The label box hangs one font size below its own top (see `labelBounds`), so line the
  // editor up on that baseline instead of on the top of the box.
  const baseline = anchor.y + (labelBox ? (style?.fontSize ?? 14) * zoom : fontSize);
  const anchorTop = baseline - ((height - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent);

  const left = Math.min(Math.max(0, anchorLeft), Math.max(0, surfaceSize.w - width));
  const top = Math.min(Math.max(0, anchorTop), Math.max(0, surfaceSize.h - height));

  return (
    <input
      className="label-editor"
      autoFocus
      value={value}
      style={{
        left,
        top,
        width,
        height,
        lineHeight: `${height}px`,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle,
        letterSpacing: style ? `${style.letterSpacing * zoom}px` : undefined,
        color: override?.fill ?? style?.color,
        textAlign: align,
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          controller.editingLabel = null;
          controller.notify();
        }
      }}
    />
  );
}
