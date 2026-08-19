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
import { rectFromPoints } from '@core/geometry/index';
import { outlineAttach, outlinePath } from '@core/geometry/outline';
import type { Change } from '@core/model/store';
import { bindTarget } from '@core/model/bind';
import type { ResolvedNodeInfo } from '@core/model/graph';
import type { Node } from '@core/model/types';
import type { EditorController, DragState } from './EditorController';
import { GridLayer, HighlightLayer } from './layers/CanvasLayers';
import { connectionMarkup, nodeMarkup, nodeTransform } from './render';

export interface EditorSurfaceProps {
  controller: EditorController;
  /** World-space content drawn under the graph (page frame, component canvas). */
  underlay?: ReactNode;
  /** World-space content drawn above the graph. */
  overlay?: ReactNode;
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

/** A zoom session ends once the user pauses this long between wheel notches. */
const ZOOM_SESSION_IDLE_MS = 600;
/** …or moves the pointer further than this, which re-picks the zoom target. */
const ZOOM_SESSION_SLOP_PX = 3;

const zoomFactor = (dy: number, perPixel: number): number =>
  Math.min(2, Math.max(0.5, Math.exp(-dy * perPixel)));

/**
 * Both ends of the rubber-band line while connecting. Surface ports have no
 * fixed spot, so each end slides along its edge to face the other.
 */
function connectPreview(controller: EditorController, drag: DragState): { a: Vec; b: Vec } {
  const graph = controller.getGraph();
  const from = drag.from;
  const source =
    from?.kind === 'port' ? graph.nodes.get(from.nodeId)?.ports.find((p) => p.id === from.portId) : undefined;
  const target = drag.hoverPort;
  let a = drag.fromPos ?? drag.start;
  if (source?.outline) a = outlineAttach(source.outline, target ? target.pos : drag.current).pos;
  let b = target ? controller.portAttach(target, a) : drag.current;
  if (source?.outline) a = outlineAttach(source.outline, b).pos;
  return { a, b };
}

export function EditorSurface({ controller, underlay, overlay }: EditorSurfaceProps): JSX.Element {
  useController(controller);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const spaceRef = useRef(false);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const box = host.getBoundingClientRect();
      setSize({ w: box.width, h: box.height });
    });
    observer.observe(host);
    const box = host.getBoundingClientRect();
    setSize({ w: box.width, h: box.height });
    return () => observer.disconnect();
  }, []);

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

    if (controller.tool === 'place' && controller.placeRef) {
      const snapped = controller.snap(world);
      const node = controller.createNode(controller.placeRef, snapped.pos);
      if (node) controller.select([node.id]);
      if (!event.shiftKey) {
        controller.tool = 'select';
        controller.placeRef = null;
      }
      controller.guides = [];
      controller.notify();
      return;
    }

    const handle = controller.handleAt(world);
    if (handle && controller.tool === 'select') {
      beginDrag({
        kind: 'resize',
        start: world,
        current: world,
        nodeIds: [handle.nodeId],
        origin: originsFor([handle.nodeId]),
        handleId: handle.handleId,
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

    const hit = controller.hitTest(world);
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
      const hit = port ? null : controller.hitTest(world);
      const nextHover = hit?.id ?? null;
      if (nextHover !== controller.hoverId || port?.id !== controller.hoverPort?.id) {
        controller.hoverId = nextHover;
        controller.hoverPort = port;
        controller.notify();
      }
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
        const b = leadInfo.bounds;
        const probes = {
          xs: [b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx, ...leadInfo.ports.map((p) => p.pos.x + dx)],
          ys: [b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy, ...leadInfo.ports.map((p) => p.pos.y + dy)],
        };
        const target = { x: leadOrigin.transform.x + dx, y: leadOrigin.transform.y + dy };
        const snapped = controller.snap(target, drag.nodeIds, probes);
        adjustX = dx + (snapped.pos.x - target.x);
        adjustY = dy + (snapped.pos.y - target.y);
        controller.guides = snapped.guides;
        controller.gridLines = snapped.gridLines;
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
        const w = Math.max(20, snapped.pos.x - info.effective.x);
        const h = Math.max(20, snapped.pos.y - info.effective.y);
        controller.guides = snapped.guides;
        controller.gridLines = snapped.gridLines;
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
      controller.gridLines = snapped.gridLines;
      controller.notify();
      return;
    }

    controller.notify();
  };

  const onPointerLeave = (): void => {
    // Nothing is under the pointer once it leaves the sheet, so drop the hover state that
    // keeps port markers and the placement ghost alive.
    if (controller.drag) return;
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
    controller.gridLines = { x: null, y: null };
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
      if (target && !(drag.from.kind === 'port' && target.nodeId === drag.from.nodeId && target.id === drag.from.portId)) {
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
    const hit = controller.hitTest(world);
    if (!hit || hit.kind !== 'node') return;
    const info = graph.nodes.get(hit.id);
    if (!info) return;
    const editable = Object.entries(info.def?.annotations ?? {})
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
        controller.drag = null;
        controller.editingLabel = null;
        controller.clearSelection();
        controller.notify();
        return;
      }
      const step = event.shiftKey ? doc.grid.size : doc.grid.size / doc.grid.subdivisions;
      if (event.key === 'ArrowLeft') controller.nudge(-step, 0);
      else if (event.key === 'ArrowRight') controller.nudge(step, 0);
      else if (event.key === 'ArrowUp') controller.nudge(0, -step);
      else if (event.key === 'ArrowDown') controller.nudge(0, step);
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

  return (
    <div
      ref={hostRef}
      className={`surface tool-${controller.tool}${!drag && controller.hoverPort ? ' hover-port' : ''}`}
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
        gridLines={controller.gridLines}
        gridSize={doc.grid.size}
        active={highlightActive}
      />

      <svg className="layer content" width={size.w} height={size.h}>
        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.zoom})`}>
          {underlay}

          {graph.connectionOrder.map((id) => {
            const info = graph.connections.get(id)!;
            return (
              <g
                key={id}
                className={`connection${controller.selection.has(id) ? ' is-selected' : ''}`}
                dangerouslySetInnerHTML={{ __html: connectionMarkup(info) }}
              />
            );
          })}

          {graph.order.map((id) => {
            const info = graph.nodes.get(id)!;
            if (info.node.hidden) return null;
            return (
              <g
                key={id}
                className={`node${controller.selection.has(id) ? ' is-selected' : ''}${controller.hoverId === id ? ' is-hover' : ''}`}
                transform={nodeTransform(info)}
                dangerouslySetInnerHTML={{ __html: nodeMarkup(info) }}
              />
            );
          })}

          {/* selection outlines */}
          {[...controller.selection].map((id) => {
            const info = graph.nodes.get(id) ?? graph.connections.get(id);
            if (!info) return null;
            const b = info.bounds;
            return (
              <rect
                key={`sel-${id}`}
                className="selection-outline"
                x={b.x - 2}
                y={b.y - 2}
                width={b.w + 4}
                height={b.h + 4}
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
                  const touch = emphasis && aim ? outlineAttach(port.outline, aim).pos : null;
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

          {overlay}
        </g>
      </svg>

      <LabelEditor controller={controller} surfaceSize={size} />
    </div>
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
  const annotation = editing && info?.def?.annotations[editing.elementId];
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

  // Match the drawn text: same font, same size, same baseline — then grow as the user types.
  const typedWidth = Math.max(value.length + 1, 4) * fontSize * 0.58;
  const width = Math.max(labelBox ? labelBox.w * zoom : 0, typedWidth);
  const fontFamily = override?.['font-family'] ?? style?.fontFamily;
  const fontWeight = override?.['font-weight'] ?? style?.fontWeight;
  const fontStyle = override?.['font-style'] ?? style?.fontStyle;
  const metrics = fontMetrics(
    `${fontStyle ?? 'normal'} ${fontWeight ?? 400} ${fontSize}px ${fontFamily ?? 'sans-serif'}`,
    fontSize,
  );
  // Tall enough to hide the label underneath, which occupies the whole font box.
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
