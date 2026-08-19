import { describe, expect, it } from 'vitest';
import { LibraryRegistry } from '../library/registry';
import { GraphEngine } from './graph';
import { toWorld } from '../geometry/index';
import { nodeTransform } from '../../editor/render';
import { DocumentStore, uid } from './store';
import { loadBaseLibrary } from '../../test/libs';
import { emptyDocument, type Connection, type Node } from './types';

function makeNode(ref: string, x: number, y: number, w = 160, h = 90, params: Record<string, unknown> = {}): Node {
  return {
    id: uid('n'),
    componentRef: ref,
    transform: { x, y, rot: 0, scale: 1 },
    size: { w, h },
    params,
    z: 0,
  };
}

function makeConn(from: Connection['from'], to: Connection['to'], params: Record<string, unknown> = {}): Connection {
  return { id: uid('c'), componentRef: 'base/arrow', from, to, waypoints: [], params, z: 0 };
}

function setup() {
  const registry = new LibraryRegistry();
  registry.load([loadBaseLibrary()]);
  const store = new DocumentStore(emptyDocument());
  const engine = new GraphEngine(store, registry);
  return { registry, store, engine };
}

describe('library registry', () => {
  it('loads every base component', () => {
    const { registry } = setup();
    const refs = registry.all().map((e) => e.ref).sort();
    expect(refs).toEqual([
      'base/arrow',
      'base/box',
      'base/circle',
      'base/diamond',
      'base/note',
      'base/title-block',
    ]);
    expect(registry.get('base/arrow')?.scriptSource).toContain('defineComponent');
  });
});

describe('GraphEngine', () => {
  it('resolves ports into world space', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 100, 200));
    const graph = engine.resolve();
    const resolved = graph.nodes.get(box.id)!;

    expect(resolved.error).toBeNull();
    expect(resolved.ports.map((p) => p.name).sort()).toEqual(['east', 'edge', 'north', 'south', 'west']);

    const east = resolved.ports.find((p) => p.name === 'east')!;
    expect(east.pos).toEqual({ x: 260, y: 245 });
    expect(east.facing).toEqual({ x: 1, y: 0 });
    // bounds include the port markers, which stick out by their radius
    expect(resolved.bounds).toMatchObject({ x: 96.5, y: 196.5 });
  });

  it('scales static geometry and ports when a node is resized', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 0, 0, 320, 180));
    const east = engine.resolve().nodes.get(box.id)!.ports.find((p) => p.name === 'east')!;
    expect(east.pos).toEqual({ x: 320, y: 90 });
  });

  it('scales resolved bounds proportionally when a node is resized (no anisotropic drift)', () => {
    const base = setup();
    const baseNode = base.store.addNode(makeNode('base/box', 0, 0, 160, 90));
    const baseBounds = base.engine.resolve().nodes.get(baseNode.id)!.bounds;

    const resized = setup();
    const resizedNode = resized.store.addNode(makeNode('base/box', 0, 0, 320, 180));
    const resizedBounds = resized.engine.resolve().nodes.get(resizedNode.id)!.bounds;

    // Uniform 2x resize should scale every edge of the bounding box by exactly 2,
    // not stretch it non-uniformly the way folding scale into the SVG transform did.
    expect(resizedBounds.x).toBeCloseTo(baseBounds.x * 2, 5);
    expect(resizedBounds.y).toBeCloseTo(baseBounds.y * 2, 5);
    expect(resizedBounds.w).toBeCloseTo(baseBounds.w * 2, 5);
    expect(resizedBounds.h).toBeCloseTo(baseBounds.h * 2, 5);
  });

  it('binds label annotations to params', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 0, 0, 160, 90, { title: 'Ingest' }));
    expect(engine.resolve().nodes.get(box.id)!.labels.title).toBe('Ingest');
  });

  it('gives every title block its own fields, falling back to document meta', () => {
    const { store, engine } = setup();
    store.setMeta({ title: 'Doc title', author: 'Doc author', revision: 'A' });
    const shared = store.addNode(makeNode('base/title-block', 0, 0, 260, 96));
    const own = store.addNode(
      makeNode('base/title-block', 0, 200, 260, 96, { title: 'Power stage', author: 'sbudya' }),
    );
    const resolved = engine.resolve();

    // A blank instance shows the document's metadata...
    expect(resolved.nodes.get(shared.id)!.labels['f-title']).toBe('Doc title');
    expect(resolved.nodes.get(shared.id)!.labels['f-author']).toBe('Doc author');
    // ...while a filled-in one is independent, field by field.
    expect(resolved.nodes.get(own.id)!.labels['f-title']).toBe('Power stage');
    expect(resolved.nodes.get(own.id)!.labels['f-author']).toBe('sbudya');
    expect(resolved.nodes.get(own.id)!.labels['f-rev']).toBe('A');
  });

  it('reports how each label is drawn, including inherited text attributes', () => {
    const { store, engine } = setup();
    const block = store.addNode(makeNode('base/title-block', 0, 0, 260, 96));
    const box = store.addNode(makeNode('base/box', 0, 300, 160, 90, { title: 'Ingest' }));
    const resolved = engine.resolve();

    const styles = resolved.nodes.get(block.id)!.labelStyles;
    expect(styles['f-title'].fontSize).toBeCloseTo(13, 5);
    expect(styles['f-title'].fontWeight).toBe('600');
    // font-family lives on the wrapping <g>, so it has to be inherited.
    expect(styles['f-title'].fontFamily).toContain('Inter');
    expect(styles['f-author'].fontSize).toBeCloseTo(10, 5);
    expect(styles['f-author'].anchor).toBe('start');

    expect(resolved.nodes.get(box.id)!.labelStyles.title.anchor).toBe('middle');
  });

  it('gives each title block field its own label box', () => {
    const { store, engine } = setup();
    const block = store.addNode(
      makeNode('base/title-block', 0, 0, 260, 96, {
        title: 'T',
        author: 'A',
        date: '2024-01-01',
        revision: 'B',
        size: 'A3',
        sheet: '2/3',
      }),
    );
    const boxes = engine.resolve().nodes.get(block.id)!.labelBoxes;
    const ids = ['f-title', 'f-author', 'f-date', 'f-rev', 'f-size', 'f-sheet'];
    for (const id of ids) expect(boxes[id]).toBeDefined();
    const keys = ids.map((id) => `${Math.round(boxes[id].x)},${Math.round(boxes[id].y)}`);
    expect(new Set(keys).size).toBe(ids.length);
  });

  it('follows dominant-baseline when placing a label box', () => {
    const { store, engine } = setup();
    const block = store.addNode(makeNode('base/title-block', 0, 0, 260, 96, { title: 'T' }));
    const box = store.addNode(makeNode('base/box', 0, 0, 160, 90, { title: 'T' }));
    const resolved = engine.resolve();
    // f-title is drawn on its own baseline (y=29, font-size 13): the box top is one font size up.
    const plain = resolved.nodes.get(block.id)!.labelBoxes['f-title'];
    expect(plain.y).toBeCloseTo(29 - 13, 5);
    // box/title is centred on y with dominant-baseline="middle", so its baseline — and the box
    // that hangs off it — sits half an x-height lower.
    const centred = resolved.nodes.get(box.id)!.labelBoxes.title;
    expect(centred.y).toBeCloseTo(50 + (14 * 0.52) / 2 - 14, 5);
  });

  it('populates labelBoxes at the label element position', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 100, 200, 160, 90, { title: 'Ingest' }));
    const resolved = engine.resolve().nodes.get(box.id)!;
    // title text sits at local (80, 50); world = node origin (100, 200) + local. The box hangs
    // off the baseline, which `dominant-baseline="middle"` pushes half an x-height (3.64) below
    // `y`, so its top is 50 + 3.64 - 14. It is centre-anchored, so it straddles the anchor.
    const title = resolved.labelBoxes.title;
    expect(title).toBeDefined();
    expect(title.x + title.w / 2).toBeCloseTo(180, 5);
    expect(title.y).toBeCloseTo(239.64, 5);
    expect(title.w).toBeGreaterThan(0);
    expect(title.h).toBeGreaterThan(0);
  });

  it('scales labelBoxes with a resized node', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 0, 0, 320, 180, { title: 'Ingest' }));
    const resolved = engine.resolve().nodes.get(box.id)!;
    // local (80, 50) scaled 2x -> (160, 100); the baseline shift, the y-offset and the measured
    // width all use the label's own (unscaled) font-size, matching how text is drawn.
    const title = resolved.labelBoxes.title;
    expect(title.x + title.w / 2).toBeCloseTo(160, 5);
    expect(title.y).toBeCloseTo(89.64, 5);
  });

  it('does not double-scale a scripted component that already draws at ctx.size', () => {
    const { registry, store, engine } = setup();
    registry.upsert(
      'base',
      {
        id: 'scripted-test',
        name: 'Scripted test',
        version: '1.0.0',
        category: 'test',
        params: [],
        geometry: { type: 'svg', source: '<g></g>' },
        annotations: {},
        script: 'scripts/scripted-test.js',
        defaultSize: { w: 100, h: 60 },
        resizable: true,
      },
      `defineComponent({
        render: function (ctx) {
          return svg.rect({ x: 0, y: 0, width: ctx.size.w, height: ctx.size.h, fill: '#fff' });
        },
      });`,
    );

    const node = store.addNode(makeNode('base/scripted-test', 0, 0, 400, 60));
    const resolved = engine.resolve().nodes.get(node.id)!;
    expect(resolved.bounds).toMatchObject({ x: 0, y: 0, w: 400, h: 60 });
  });

  it('no longer has an autoColor param and never applies a green fill', () => {
    const { registry, store, engine } = setup();
    const def = registry.get('base/box')!.def;
    expect(def.params.some((p) => p.name === 'autoColor')).toBe(false);

    const a = store.addNode(makeNode('base/box', 0, 0, 160, 90));
    for (const port of ['p-n', 'p-e', 'p-s', 'p-w']) {
      store.addConnection(makeConn({ kind: 'port', nodeId: a.id, portId: port }, { kind: 'free', x: 500, y: 500 }));
    }
    const resolved = engine.resolve().nodes.get(a.id)!;
    expect(resolved.styles.body.fill).not.toBe('#e6f6ec');
    expect(resolved.styles.body.stroke).not.toBe('#2f855a');
  });

  it('runs the box style script without any auto-colouring on connection state', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0, 160, 90));

    const before = engine.resolve().nodes.get(a.id)!;
    expect(before.styles.body.fill).toBe('#ffffff');
    expect(before.styles.body.stroke).toBe('#2e3440');

    for (const port of ['p-n', 'p-e', 'p-s', 'p-w']) {
      store.addConnection(makeConn({ kind: 'port', nodeId: a.id, portId: port }, { kind: 'free', x: 500, y: 500 }));
    }

    const after = engine.resolve().nodes.get(a.id)!;
    expect(after.styles.body.fill).toBe('#ffffff');
    expect(after.styles.body.stroke).toBe('#2e3440');
  });

  it('routes an arrow between two ports using the component script', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    const b = store.addNode(makeNode('base/box', 400, 0));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'p-e' }, { kind: 'port', nodeId: b.id, portId: 'p-w' }),
    );

    const resolved = engine.resolve().connections.get(conn.id)!;
    expect(resolved.error).toBeNull();
    expect(resolved.points.length).toBeGreaterThanOrEqual(2);
    expect(resolved.points[0]).toEqual({ x: 160, y: 45 });
    expect(resolved.points.at(-1)).toEqual({ x: 400, y: 45 });
    // path + arrow head inside a group
    expect(resolved.vnodes[0].tag).toBe('g');
    expect(resolved.vnodes[0].children.some((c) => c.tag === 'path')).toBe(true);
    expect(resolved.vnodes[0].children.some((c) => c.tag === 'polygon')).toBe(true);
  });

  it('gives connector scripts the obstacle set on the very first resolve', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    const b = store.addNode(makeNode('base/box', 600, 0));
    // Straight in the way of the direct a → b run.
    store.addNode(makeNode('base/box', 280, -20, 120, 140));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'p-e' }, { kind: 'port', nodeId: b.id, portId: 'p-w' }),
    );

    // No warm-up resolve: the spatial index must already be populated.
    const resolved = engine.resolve().connections.get(conn.id)!;

    const straightThrough = resolved.points.every((p) => Math.abs(p.y - 45) < 1e-6);
    expect(straightThrough).toBe(false);
    expect(resolved.points.length).toBeGreaterThan(2);
  });

  it('moves connector endpoints when the anchored component moves', () => {    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    const b = store.addNode(makeNode('base/box', 400, 0));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'p-e' }, { kind: 'port', nodeId: b.id, portId: 'p-w' }),
    );

    engine.resolve();
    store.updateNode(b.id, { transform: { x: 400, y: 300, rot: 0, scale: 1 } });
    const resolved = engine.resolve().connections.get(conn.id)!;

    expect(resolved.points.at(-1)).toEqual({ x: 400, y: 345 });
  });

  it('follows attachments so a child moves with its parent', () => {
    const { store, engine } = setup();
    const parent = store.addNode(makeNode('base/box', 100, 100));
    const child = store.addNode({
      ...makeNode('base/note', 0, 0, 120, 60),
      attachment: { parentId: parent.id, anchorId: 'a-top', offset: { x: 0, y: -80 } },
    });

    const first = engine.resolve().nodes.get(child.id)!;
    expect(first.effective).toMatchObject({ x: 180, y: 20 });

    store.updateNode(parent.id, { transform: { x: 500, y: 100, rot: 0, scale: 1 } });
    const second = engine.resolve().nodes.get(child.id)!;
    expect(second.effective).toMatchObject({ x: 580, y: 20 });
  });

  it('survives attachment cycles without hanging', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    const b = store.addNode(makeNode('base/box', 200, 0));
    store.updateNode(a.id, { attachment: { parentId: b.id, anchorId: 'a-top', offset: { x: 0, y: 0 } } });
    store.updateNode(b.id, { attachment: { parentId: a.id, anchorId: 'a-top', offset: { x: 0, y: 0 } } });

    const graph = engine.resolve();
    expect(graph.nodes.size).toBe(2);
  });

  it('keeps the alignment index in sync with resolved bounds', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 100, 0));
    store.addNode(makeNode('base/box', 100, 400));
    engine.resolve();

    expect(engine.alignment.queryX(100, 0.5)[0].sources).toHaveLength(2);

    store.updateNode(a.id, { transform: { x: 700, y: 0, rot: 0, scale: 1 } });
    engine.resolve();
    expect(engine.alignment.queryX(100, 0.5)[0].sources).toHaveLength(1);
  });

  it('drops index entries for deleted nodes and their connections', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    const b = store.addNode(makeNode('base/box', 400, 0));
    store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'p-e' }, { kind: 'port', nodeId: b.id, portId: 'p-w' }),
    );
    engine.resolve();

    store.removeNode(b.id);
    const graph = engine.resolve();
    expect(graph.nodes.size).toBe(1);
    expect(graph.connections.size).toBe(0);
    expect(engine.alignment.queryX(400, 0.5)).toHaveLength(0);
  });

  it('renders a placeholder for unknown components', () => {
    const { store, engine } = setup();
    const ghost = store.addNode(makeNode('nope/missing', 0, 0));
    const resolved = engine.resolve().nodes.get(ghost.id)!;
    expect(resolved.error).toMatch(/unknown component/);
    expect(resolved.vnodes.length).toBeGreaterThan(0);
  });

  it('resolves shared library modules through require', () => {
    const { store, engine } = setup();
    const circle = store.addNode(makeNode('base/circle', 0, 0, 120, 120, { fill: '#123456' }));
    const resolved = engine.resolve().nodes.get(circle.id)!;
    expect(resolved.error).toBeNull();
    expect(resolved.styles.body.fill).toBe('#123456');
  });
});

describe('surface ports', () => {
  it('exposes the whole circumference of a circle as one port', () => {
    const { store, engine } = setup();
    const circle = store.addNode(makeNode('base/circle', 0, 0, 120, 120));
    const port = engine.resolve().nodes.get(circle.id)!.ports.find((p) => p.id === 'edge')!;

    expect(port.outline).toBeDefined();
    expect(port.outline!.kind).toBe('ellipse');
    expect(port.pos).toEqual({ x: 60, y: 60 });
    if (port.outline!.kind === 'ellipse') {
      expect(port.outline!.rx).toBeCloseTo(60, 6);
      expect(port.outline!.ry).toBeCloseTo(60, 6);
    }
  });

  it('terminates a connector on the circumference, facing the other node', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/circle', 0, 0, 120, 120));
    const b = store.addNode(makeNode('base/circle', 400, 0, 120, 120));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'edge' }, { kind: 'port', nodeId: b.id, portId: 'edge' }),
    );
    const info = engine.resolve().connections.get(conn.id)!;
    const first = info.points[0];
    const last = info.points[info.points.length - 1];

    expect(Math.hypot(first.x - 60, first.y - 60)).toBeCloseTo(60, 3);
    expect(Math.hypot(last.x - 460, last.y - 60)).toBeCloseTo(60, 3);
    // The ends face each other along the line of centres.
    expect(first).toMatchObject({ x: 120, y: 60 });
    expect(last).toMatchObject({ x: 400, y: 60 });
  });

  it('slides the attachment round the shape when the other end moves', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/circle', 0, 0, 120, 120));
    const b = store.addNode(makeNode('base/circle', 0, 400, 120, 120));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: a.id, portId: 'edge' }, { kind: 'port', nodeId: b.id, portId: 'edge' }),
    );
    const first = engine.resolve().connections.get(conn.id)!.points[0];
    expect(first).toMatchObject({ x: 60, y: 120 });
  });

  it('lands on the side of a box, not at its centre', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 0, 0, 160, 90));
    const target = store.addNode(makeNode('base/box', 500, 0, 160, 90));
    const conn = store.addConnection(
      makeConn({ kind: 'port', nodeId: box.id, portId: 'edge' }, { kind: 'port', nodeId: target.id, portId: 'edge' }),
    );
    const points = engine.resolve().connections.get(conn.id)!.points;
    expect(points[0]).toMatchObject({ x: 160, y: 45 });
    expect(points[points.length - 1]).toMatchObject({ x: 500, y: 45 });
  });

  it('follows the node when it is rotated', () => {
    const { store, engine } = setup();
    const box = store.addNode(makeNode('base/box', 0, 0, 160, 90));
    store.updateNode(box.id, { transform: { x: 0, y: 0, rot: 90, scale: 1 } });
    const port = engine.resolve().nodes.get(box.id)!.ports.find((p) => p.id === 'edge')!;
    const outline = port.outline!;
    expect(outline.kind).toBe('polygon');
    if (outline.kind === 'polygon') {
      const xs = outline.points.map((p) => p.x);
      const ys = outline.points.map((p) => p.y);
      // A 90 degree turn about the box centre swaps the footprint.
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(90, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(160, 6);
    }
  });

  it('aims at the nearest waypoint when the connection has one', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/circle', 0, 0, 120, 120));
    const b = store.addNode(makeNode('base/circle', 400, 0, 120, 120));
    const conn = store.addConnection({
      ...makeConn({ kind: 'port', nodeId: a.id, portId: 'edge' }, { kind: 'port', nodeId: b.id, portId: 'edge' }),
      waypoints: [{ x: 60, y: -300 }],
    });
    const first = engine.resolve().connections.get(conn.id)!.points[0];
    expect(first).toMatchObject({ x: 60, y: 0 });
  });
});

describe('undo/redo', () => {
  it('restores nodes and connections', () => {
    const { store, engine } = setup();
    const a = store.addNode(makeNode('base/box', 0, 0));
    store.updateNode(a.id, { transform: { x: 50, y: 50, rot: 0, scale: 1 } });

    store.undo();
    expect(store.getDocument().nodes[a.id].transform.x).toBe(0);

    store.redo();
    expect(store.getDocument().nodes[a.id].transform.x).toBe(50);

    store.undo();
    store.undo();
    expect(store.getDocument().nodeOrder).toHaveLength(0);
    expect(engine.resolve().nodes.size).toBe(0);
  });

  it('treats a transaction as one undo step', () => {
    const { store } = setup();
    store.transact('add pair', () => {
      store.addNode(makeNode('base/box', 0, 0));
      store.addNode(makeNode('base/box', 200, 0));
    });
    expect(store.getDocument().nodeOrder).toHaveLength(2);
    store.undo();
    expect(store.getDocument().nodeOrder).toHaveLength(0);
  });
});

describe('rotation pivot', () => {
  it('turns a node about the middle of its box, not its corner', () => {
    const { store, engine } = setup();
    const node = store.addNode(makeNode('base/box', 100, 100, 200, 100));
    const before = engine.resolve().nodes.get(node.id)!;
    const centre = toWorld(before.effective, { x: 100, y: 50 });

    store.updateNode(node.id, (n) => ({ transform: { ...n.transform, rot: 90 } }));
    const after = engine.resolve().nodes.get(node.id)!;

    expect(after.effective.pivot).toEqual({ x: 100, y: 50 });
    // The centre of the instance box is the fixed point of the rotation.
    expect(toWorld(after.effective, { x: 100, y: 50 })).toEqual(centre);
    // A quarter turn swaps the footprint instead of swinging it away.
    expect(after.bounds.w).toBeCloseTo(before.bounds.h, 3);
    expect(after.bounds.h).toBeCloseTo(before.bounds.w, 3);
    expect(Math.abs(after.bounds.x + after.bounds.w / 2 - (before.bounds.x + before.bounds.w / 2))).toBeLessThan(2);
    expect(Math.abs(after.bounds.y + after.bounds.h / 2 - (before.bounds.y + before.bounds.h / 2))).toBeLessThan(2);
  });

  it('rotates ports about the same centre', () => {
    const { store, engine } = setup();
    const node = store.addNode(makeNode('base/box', 0, 0, 200, 100));
    const east = engine.resolve().nodes.get(node.id)!.ports.find((p) => p.id === 'p-e')!;

    store.updateNode(node.id, (n) => ({ transform: { ...n.transform, rot: 180 } }));
    const flipped = engine.resolve().nodes.get(node.id)!.ports.find((p) => p.id === 'p-e')!;

    expect(flipped.pos.x).toBeCloseTo(200 - east.pos.x, 3);
    expect(flipped.pos.y).toBeCloseTo(100 - east.pos.y, 3);
  });

  it('emits an SVG rotate about the pivot', () => {
    const { store, engine } = setup();
    const node = store.addNode(makeNode('base/box', 10, 20, 200, 100));
    store.updateNode(node.id, (n) => ({ transform: { ...n.transform, rot: 45 } }));
    const info = engine.resolve().nodes.get(node.id)!;
    expect(nodeTransform(info)).toBe('translate(10 20) rotate(45 100 50)');
  });

  it('leaves an unrotated node without a pivot', () => {
    const { store, engine } = setup();
    const node = store.addNode(makeNode('base/box', 10, 20));
    const info = engine.resolve().nodes.get(node.id)!;
    expect(info.effective.pivot).toBeUndefined();
    expect(nodeTransform(info)).toBe('translate(10 20)');
  });
});
