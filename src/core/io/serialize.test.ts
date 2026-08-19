import { describe, expect, it } from 'vitest';
import { LibraryRegistry } from '../library/registry';
import { GraphEngine } from '../model/graph';
import { DocumentStore, uid } from '../model/store';
import { emptyDocument, makePage, type SwDocument } from '../model/types';
import { loadBaseLibrary } from '../../test/libs';
import { SCHEMA_VERSION, deserializeDocument, documentToJson, serializeDocument } from './serialize';

function sampleDocument(): SwDocument {
  const store = new DocumentStore(emptyDocument());
  const a = store.addNode({
    id: uid('n'),
    componentRef: 'base/box',
    transform: { x: 40, y: 60, rot: 0, scale: 1 },
    size: { w: 160, h: 90 },
    params: { title: 'First', fill: '#eef' },
    z: 0,
  });
  const b = store.addNode({
    id: uid('n'),
    componentRef: 'base/circle',
    transform: { x: 420, y: 260, rot: 15, scale: 1 },
    size: { w: 120, h: 120 },
    params: { title: 'Second' },
    z: 1,
  });
  const note = store.addNode({
    id: uid('n'),
    componentRef: 'base/note',
    transform: { x: 0, y: 0, rot: 0, scale: 1 },
    size: { w: 120, h: 80 },
    params: {},
    attachment: { parentId: a.id, anchorId: 'a-top', offset: { x: 12, y: -20 } },
    z: 2,
  });
  store.addConnection({
    id: uid('c'),
    componentRef: 'base/arrow',
    from: { kind: 'port', nodeId: a.id, portId: 'p-east' },
    to: { kind: 'port', nodeId: b.id, portId: 'p-west' },
    waypoints: [{ x: 300, y: 120 }],
    params: { style: 'orthogonal' },
    z: 0,
  });
  store.setPage(makePage('A4', 'landscape'));
  store.setLegend({ componentRef: 'base/title-block', fields: { rev: 'B' } });
  store.setGrid({ size: 25, subdivisions: 5 });
  store.setMeta({ title: 'Round trip', author: 'tester' });
  void note;
  return store.getDocument();
}

describe('serialization', () => {
  it('round-trips a document without losing data', () => {
    const doc = sampleDocument();
    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored.nodeOrder).toEqual(doc.nodeOrder);
    expect(restored.connectionOrder).toEqual(doc.connectionOrder);
    expect(restored.grid).toEqual(doc.grid);
    expect(restored.page).toEqual(doc.page);
    expect(restored.legend).toEqual(doc.legend);
    expect(restored.meta).toEqual(doc.meta);
    for (const id of doc.nodeOrder) expect(restored.nodes[id]).toEqual(doc.nodes[id]);
    for (const id of doc.connectionOrder) expect(restored.connections[id]).toEqual(doc.connections[id]);
  });

  it('round-trips through JSON text', () => {
    const doc = sampleDocument();
    const json = documentToJson(doc);
    const restored = deserializeDocument(JSON.parse(json));
    expect(serializeDocument(restored)).toEqual(serializeDocument(doc));
    expect(JSON.parse(json).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('resolves to identical geometry after a round trip', () => {
    const registry = new LibraryRegistry();
    registry.load([loadBaseLibrary()]);

    const doc = sampleDocument();
    const before = new GraphEngine(new DocumentStore(doc), registry).resolve();
    const after = new GraphEngine(new DocumentStore(deserializeDocument(serializeDocument(doc))), registry).resolve();

    expect([...after.nodes.keys()]).toEqual([...before.nodes.keys()]);
    for (const [id, info] of before.nodes) {
      const other = after.nodes.get(id)!;
      expect(other.bounds).toEqual(info.bounds);
      expect(other.ports.map((p) => [p.id, p.pos])).toEqual(info.ports.map((p) => [p.id, p.pos]));
    }
    for (const [id, info] of before.connections) {
      expect(after.connections.get(id)!.points).toEqual(info.points);
    }
  });

  it('tolerates malformed input and unknown fields', () => {
    const restored = deserializeDocument({
      schemaVersion: SCHEMA_VERSION,
      nodes: [{ id: 'n1', componentRef: 'base/box', extra: 'ignored' }, null, { componentRef: 'no-id' }],
      connections: [{ id: 'c1', from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: 10, y: 10 } }],
    });
    expect(restored.nodeOrder).toEqual(['n1']);
    expect(restored.nodes.n1.transform).toEqual({ x: 0, y: 0, rot: 0, scale: 1 });
    expect(restored.connectionOrder).toEqual(['c1']);
    expect(restored.grid.size).toBeGreaterThan(0);
  });
});
