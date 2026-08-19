import { describe, expect, it } from 'vitest';
import type { Outline } from '@core/geometry/outline';
import { LibraryRegistry } from '@core/library/registry';
import { GraphEngine } from '@core/model/graph';
import { DocumentStore, uid } from '@core/model/store';
import { emptyDocument, type ComponentDef, type LoadedLibrary, type Node } from '@core/model/types';
import { loadBaseLibrary } from '../test/libs';
import { chooseAxisSnap, EditorController, isCompactOutline, parseClipboard, safeStep } from './EditorController';

function makeNode(x: number, y: number, w = 100, h = 60): Node {
  return {
    id: uid('n'),
    componentRef: 'base/rect',
    transform: { x, y, rot: 0, scale: 1 },
    size: { w, h },
    params: {},
    z: 0,
  };
}

function setup(): EditorController {
  const registry = new LibraryRegistry();
  registry.load([loadBaseLibrary()]);
  const store = new DocumentStore(emptyDocument());
  const engine = new GraphEngine(store, registry);
  return new EditorController(store, registry, engine);
}

describe('viewport', () => {
  it('zoomAt keeps the world point under the cursor fixed and publishes a new object', () => {
    const controller = setup();
    const screen = { x: 400, y: 300 };
    const before = controller.toWorld(screen);
    const prevViewport = controller.viewport;

    controller.zoomAt(screen, 1.5);

    expect(controller.viewport).not.toBe(prevViewport);
    const afterWorld = controller.toWorld(screen);
    expect(afterWorld.x).toBeCloseTo(before.x, 9);
    expect(afterWorld.y).toBeCloseTo(before.y, 9);
  });

  it('clamps zoom at the minimum and maximum', () => {
    const controller = setup();
    for (let i = 0; i < 40; i += 1) controller.zoomAt({ x: 0, y: 0 }, 0.5);
    expect(controller.viewport.zoom).toBeCloseTo(0.05, 5);

    for (let i = 0; i < 40; i += 1) controller.zoomAt({ x: 0, y: 0 }, 2);
    expect(controller.viewport.zoom).toBeCloseTo(8, 5);
  });

  it('panBy shifts tx/ty and produces a new viewport object', () => {
    const controller = setup();
    const prevViewport = controller.viewport;
    const { tx, ty } = controller.viewport;

    controller.panBy(10, -5);

    expect(controller.viewport).not.toBe(prevViewport);
    expect(controller.viewport.tx).toBe(tx + 10);
    expect(controller.viewport.ty).toBe(ty - 5);
  });

  it('recenter moves the world point under a screen position to the target, keeping zoom', () => {
    const controller = setup();
    controller.setViewport({ tx: 37, ty: -12, zoom: 2.5 });
    const cursor = { x: 220, y: 640 };
    const centre = { x: 800, y: 475 };
    const world = controller.toWorld(cursor);

    controller.recenter(cursor, centre);

    expect(controller.viewport.zoom).toBe(2.5);
    const after = controller.toScreen(world);
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
  });

  it('recentring then zooming about the centre keeps that world point centred', () => {
    const controller = setup();
    const cursor = { x: 300, y: 200 };
    const centre = { x: 800, y: 475 };
    const world = controller.toWorld(cursor);

    controller.recenter(cursor, centre);
    controller.zoomAt(centre, 1.6);
    controller.zoomAt(centre, 1.6);

    const after = controller.toScreen(world);
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
  });
});

describe('safeStep', () => {
  it('matches size / subdivisions for well-formed grids', () => {
    expect(safeStep(20, 4)).toBeCloseTo(5, 9);
    expect(safeStep(5, 5)).toBeCloseTo(1, 9);
  });

  it('falls back to a finite, positive step when subdivisions is degenerate', () => {
    expect(safeStep(5, 0)).toBe(5);
    expect(safeStep(5, undefined as unknown as number)).toBe(5);
    expect(safeStep(5, NaN)).toBe(5);
    expect(safeStep(5, -3)).toBe(5);
  });

  it('returns 0 (no snapping) when size itself is degenerate', () => {
    expect(safeStep(0, 4)).toBe(0);
    expect(safeStep(NaN, 4)).toBe(0);
    expect(safeStep(-5, 4)).toBe(0);
  });
});

describe('chooseAxisSnap', () => {
  it('prefers alignment within the bias epsilon', () => {
    const choice = chooseAxisSnap(102, { coord: 105, delta: 3 }, true, 5, 0, 2);
    expect(choice.primaryCoord).toBe(105);
    expect(choice.value).toBe(105);
  });

  it('prefers the grid when it is clearly closer', () => {
    const choice = chooseAxisSnap(100, { coord: 110, delta: 10 }, true, 5, 0, 2);
    expect(choice.primaryCoord).toBeNull();
    expect(choice.value).toBe(100);
  });

  it('rejects an alignment that would land between grid lines', () => {
    const choice = chooseAxisSnap(100, { coord: 101, delta: 1 }, true, 5, 0, 2);
    expect(choice.primaryCoord).toBeNull();
    expect(choice.value).toBe(100);
  });

  it('still honours off-lattice alignment when grid snapping is off', () => {
    const choice = chooseAxisSnap(100, { coord: 101, delta: 1 }, false, 5, 0, 2);
    expect(choice.primaryCoord).toBe(101);
    expect(choice.value).toBe(101);
  });
});

describe('EditorController.snap', () => {
  it('snaps exactly onto the drawn grid lattice for a size-5 grid', () => {
    const controller = setup();
    controller.store.setGrid({ size: 5, subdivisions: 4, snap: true, origin: { x: 0, y: 0 } });

    const result = controller.snap({ x: 12.6, y: 8.1 });

    expect(result.pos.x % 1.25).toBeCloseTo(0, 9);
    expect(result.pos.y % 1.25).toBeCloseTo(0, 9);
    expect(result.gridLines.x).toBeCloseTo(result.pos.x, 9);
    expect(result.gridLines.y).toBeCloseTo(result.pos.y, 9);
  });

  it('does not produce NaN when subdivisions is 0 or undefined', () => {
    const controller = setup();
    controller.store.setGrid({ size: 5, subdivisions: 0, snap: true, origin: { x: 0, y: 0 } });
    const a = controller.snap({ x: 12.6, y: 8.1 });
    expect(Number.isNaN(a.pos.x)).toBe(false);
    expect(Number.isNaN(a.pos.y)).toBe(false);

    controller.store.setGrid({ subdivisions: undefined as unknown as number });
    const b = controller.snap({ x: 12.6, y: 8.1 });
    expect(Number.isNaN(b.pos.x)).toBe(false);
    expect(Number.isNaN(b.pos.y)).toBe(false);
  });

  it('reports every in-tolerance alignment guide with exactly one primary per axis, de-duplicated', () => {    const controller = setup();
    controller.store.setGrid({ snap: false });
    controller.store.addNode(makeNode(0, 0));
    controller.store.addNode(makeNode(100.5, 0));
    controller.store.addNode(makeNode(200, 60.5));
    controller.getGraph();

    const result = controller.snap({ x: 100, y: 0 });
    const xGuides = result.guides.filter((g) => g.axis === 'x');
    const yGuides = result.guides.filter((g) => g.axis === 'y');

    expect(xGuides.length).toBeGreaterThan(1);
    expect(xGuides.filter((g) => g.strength === 'primary')).toHaveLength(1);
    expect(yGuides.filter((g) => g.strength === 'primary')).toHaveLength(1);

    const coords = xGuides.map((g) => g.coord);
    expect(new Set(coords).size).toBe(coords.length);
  });

  it('never lands off the lattice, even when a neighbour is off-grid', () => {
    const controller = setup();
    controller.store.setGrid({ size: 20, subdivisions: 4, snap: true, origin: { x: 0, y: 0 } });
    // A legacy node sitting between grid lines: its edges must not drag others off-grid.
    controller.store.addNode(makeNode(249.111, 249.111));
    controller.getGraph();

    for (const probe of [
      { x: 248, y: 248 },
      { x: 250.4, y: 251.6 },
      { x: 307.9, y: 311.2 },
    ]) {
      const result = controller.snap(probe);
      expect(result.pos.x % 5).toBeCloseTo(0, 9);
      expect(result.pos.y % 5).toBeCloseTo(0, 9);
    }
  });

  it('still snaps to an on-lattice neighbour in preference to the nearest grid line', () => {
    const controller = setup();
    controller.store.setGrid({ size: 20, subdivisions: 4, snap: true, origin: { x: 0, y: 0 } });
    controller.store.addNode(makeNode(100, 200));
    controller.getGraph();

    const result = controller.snap({ x: 103, y: 197 });

    expect(result.pos.x).toBeCloseTo(100, 9);
    expect(result.pos.y).toBeCloseTo(200, 9);
    expect(result.guides.some((g) => g.strength === 'primary')).toBe(true);
  });
});

describe('clipboard', () => {
  const twoConnectedBoxes = (controller: EditorController) => {
    const a = controller.store.addNode({ ...makeNode(100, 100), componentRef: 'base/box' });
    const b = controller.store.addNode({ ...makeNode(400, 100), componentRef: 'base/box' });
    const conn = controller.store.addConnection({
      id: uid('c'),
      componentRef: 'base/arrow',
      from: { kind: 'port', nodeId: a.id, portId: 'p-e' },
      to: { kind: 'port', nodeId: b.id, portId: 'p-w' },
      waypoints: [],
      params: {},
      z: 0,
    });
    return { a, b, conn };
  };

  it('copies the selected nodes with their top-left as the origin', () => {
    const controller = setup();
    const { a, b } = twoConnectedBoxes(controller);
    controller.select([a.id, b.id]);

    const payload = controller.copySelection();
    expect(payload?.nodes.map((n) => n.id)).toEqual([a.id, b.id]);
    expect(payload?.origin).toEqual({ x: 100, y: 100 });
  });

  it('carries a connection only when both of its endpoints are copied', () => {
    const controller = setup();
    const { a, b } = twoConnectedBoxes(controller);

    controller.select([a.id]);
    expect(controller.copySelection()?.connections).toEqual([]);

    controller.select([a.id, b.id]);
    expect(controller.copySelection()?.connections.length).toBe(1);
  });

  it('pastes fresh ids and rewires the copied connection to the copied nodes', () => {
    const controller = setup();
    const { a, b } = twoConnectedBoxes(controller);
    controller.select([a.id, b.id]);
    const payload = controller.copySelection()!;

    const created = controller.pasteClipboard(payload, { x: 40, y: 0 });
    const doc = controller.store.getDocument();
    const newNodes = created.filter((id) => doc.nodes[id]);
    const newConns = created.filter((id) => doc.connections[id]);

    expect(newNodes.length).toBe(2);
    expect(newConns.length).toBe(1);
    expect(newNodes).not.toContain(a.id);
    const conn = doc.connections[newConns[0]];
    expect(conn.from.kind === 'port' && newNodes.includes(conn.from.nodeId)).toBe(true);
    expect(conn.to.kind === 'port' && newNodes.includes(conn.to.nodeId)).toBe(true);
    expect(doc.nodes[newNodes[0]].transform.x).toBe(140);
  });

  it('selects what it pasted and leaves the originals alone', () => {
    const controller = setup();
    const { a } = twoConnectedBoxes(controller);
    controller.select([a.id]);
    const created = controller.pasteClipboard(controller.copySelection()!, { x: 10, y: 10 });
    expect([...controller.selection]).toEqual(created);
    expect(controller.store.getDocument().nodes[a.id].transform).toEqual({ x: 100, y: 100, rot: 0, scale: 1 });
  });

  it('drops an attachment whose parent was not copied but keeps an internal one', () => {
    const controller = setup();
    const parent = controller.store.addNode({ ...makeNode(0, 0), componentRef: 'base/box' });
    const child = controller.store.addNode({
      ...makeNode(50, 50),
      componentRef: 'base/box',
      attachment: { parentId: parent.id, anchorId: 'a-c', offset: { x: 5, y: 5 } },
    });

    controller.select([child.id]);
    const orphan = controller.pasteClipboard(controller.copySelection()!, { x: 0, y: 200 });
    expect(controller.store.getDocument().nodes[orphan[0]].attachment).toBeUndefined();

    controller.select([parent.id, child.id]);
    const both = controller.pasteClipboard(controller.copySelection()!, { x: 400, y: 0 });
    const pastedChild = both.map((id) => controller.store.getDocument().nodes[id]).find((n) => n?.attachment);
    expect(pastedChild?.attachment?.parentId).toBe(both[0]);
  });

  it('pastes under the cursor when no offset is given', () => {
    const controller = setup();
    const { a } = twoConnectedBoxes(controller);
    controller.select([a.id]);
    const payload = controller.copySelection()!;
    controller.snapEnabled = false;
    controller.cursorWorld = { x: 640, y: 480 };

    const created = controller.pasteClipboard(payload);
    expect(controller.store.getDocument().nodes[created[0]].transform).toMatchObject({ x: 640, y: 480 });
  });

  it('cut removes the originals but keeps them on the clipboard', () => {
    const controller = setup();
    const { a, b } = twoConnectedBoxes(controller);
    controller.select([a.id, b.id]);

    const payload = controller.cutSelection()!;
    expect(controller.store.getDocument().nodeOrder).toEqual([]);

    const created = controller.pasteClipboard(payload, { x: 0, y: 0 });
    expect(created.filter((id) => controller.store.getDocument().nodes[id]).length).toBe(2);
  });

  it('round-trips through clipboard text and rejects foreign payloads', () => {
    const controller = setup();
    const { a } = twoConnectedBoxes(controller);
    controller.select([a.id]);
    const payload = controller.copySelection()!;

    expect(parseClipboard(JSON.stringify(payload))?.nodes.length).toBe(1);
    expect(parseClipboard('hello world')).toBeNull();
    expect(parseClipboard(JSON.stringify({ kind: 'other', nodes: [] }))).toBeNull();
  });

  it('cascades repeated pastes instead of stacking them', () => {
    const controller = setup();
    const node = controller.store.addNode({ ...makeNode(100, 100), componentRef: 'base/box' });
    controller.select([node.id]);
    const payload = controller.copySelection()!;
    controller.snapEnabled = false;
    controller.cursorWorld = { x: 500, y: 500 };

    const first = controller.pasteClipboard(payload)[0];
    const second = controller.pasteClipboard(payload)[0];
    const doc = controller.store.getDocument();
    expect(doc.nodes[first].transform).toMatchObject({ x: 500, y: 500 });
    expect(doc.nodes[second].transform.x).toBeGreaterThan(500);
  });
  it('copies nothing when the selection is empty', () => {
    const controller = setup();
    expect(controller.copySelection()).toBeNull();
    expect(controller.cutSelection()).toBeNull();
  });
});

describe('surface ports', () => {
  const boxAt = (controller: EditorController, x: number, y: number): string => {
    const node = controller.store.addNode({ ...makeNode(x, y, 160, 90), componentRef: 'base/box' });
    controller.getGraph();
    return node.id;
  };

  it('picks up a click anywhere on the stroke, not just at the compass dots', () => {
    const controller = setup();
    boxAt(controller, 0, 0);
    const port = controller.portAt({ x: 30, y: 0 });
    expect(port?.id).toBe('edge');
    expect(port?.outline).toBeDefined();
  });

  it('ignores the interior of the shape', () => {
    const controller = setup();
    boxAt(controller, 0, 0);
    expect(controller.portAt({ x: 80, y: 45 })).toBeNull();
  });

  it('lets a discrete port win where the two overlap', () => {
    const controller = setup();
    boxAt(controller, 0, 0);
    expect(controller.portAt({ x: 160, y: 45 })?.id).toBe('p-e');
  });

  it('can be excluded so a drag on the border still moves the node', () => {
    const controller = setup();
    boxAt(controller, 0, 0);
    expect(controller.portAt({ x: 30, y: 0 }, false)).toBeNull();
    expect(controller.portAt({ x: 80, y: 0 }, false)?.id).toBe('p-n');
  });

  it('reports where a connector arriving from a direction would land', () => {
    const controller = setup();
    boxAt(controller, 0, 0);
    const port = controller.portAt({ x: 30, y: 0 })!;
    expect(controller.portAttach(port, { x: 80, y: -500 })).toMatchObject({ x: 80, y: 0 });
    expect(controller.portAttach(port, { x: 500, y: 45 })).toMatchObject({ x: 160, y: 45 });
  });
});

describe('compact surface ports', () => {
  // A body edge, a small annotated pin and a rail that spans the whole node.
  const pinLibrary = (): LoadedLibrary => {
    const def: ComponentDef = {
      id: 'pin',
      name: 'Pin',
      version: '1.0.0',
      params: [],
      geometry: {
        type: 'svg',
        source:
          '<svg viewBox="0 0 100 60">' +
          '<rect id="body" x="0" y="0" width="100" height="60" />' +
          '<circle id="pin" cx="100" cy="30" r="4" />' +
          '<path id="rail" d="M 0 60 L 100 60" />' +
          '</svg>',
      },
      annotations: {
        body: { kind: 'port', name: 'body', surface: 'outline' },
        pin: { kind: 'port', name: 'pin', surface: 'outline' },
        rail: { kind: 'port', name: 'rail', surface: 'outline' },
      },
      defaultSize: { w: 100, h: 60 },
    };
    return {
      manifest: { id: 'pins', name: 'Pins', version: '1.0.0' },
      components: { pin: def },
      scripts: {},
      shared: {},
      dir: 'libs/pins',
    };
  };

  const setupPins = (): EditorController => {
    const registry = new LibraryRegistry();
    registry.load([loadBaseLibrary(), pinLibrary()]);
    const store = new DocumentStore(emptyDocument());
    const engine = new GraphEngine(store, registry);
    const controller = new EditorController(store, registry, engine);
    store.addNode({ ...makeNode(0, 0, 100, 60), componentRef: 'pins/pin' });
    controller.getGraph();
    return controller;
  };

  it('measures a small annotated shape as compact', () => {
    expect(isCompactOutline({ kind: 'ellipse', c: { x: 100, y: 30 }, rx: 4, ry: 4, rot: 0 }, { x: 0, y: 0, w: 100, h: 60 })).toBe(true);
  });

  it('measures a body-sized outline as broad', () => {
    const body: Outline = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 },
      ],
      closed: true,
    };
    expect(isCompactOutline(body, { x: 0, y: 0, w: 100, h: 60 })).toBe(false);
  });

  it('measures a zero-area line that spans the node as broad', () => {
    const rail: Outline = {
      kind: 'polygon',
      points: [
        { x: 0, y: 60 },
        { x: 100, y: 60 },
      ],
      closed: false,
    };
    expect(isCompactOutline(rail, { x: 0, y: 0, w: 100, h: 60 })).toBe(false);
  });

  it('can be grabbed outside the connect tool, unlike the body edge', () => {
    const controller = setupPins();
    expect(controller.portAt({ x: 100, y: 26 }, false)?.id).toBe('pin');
    expect(controller.portAt({ x: 50, y: 0 }, false)).toBeNull();
    expect(controller.portAt({ x: 50, y: 60 }, false)).toBeNull();
  });

  it('still wins over the body edge while connecting', () => {
    const controller = setupPins();
    expect(controller.portAt({ x: 100, y: 26 })?.id).toBe('pin');
    expect(controller.portAt({ x: 50, y: 0 })?.id).toBe('body');
  });
});
