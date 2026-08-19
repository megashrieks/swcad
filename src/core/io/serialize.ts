import type { Connection, Node, SwDocument } from '../model/types';
import { DEFAULT_GRID, emptyDocument } from '../model/types';

export const SCHEMA_VERSION = 1;

export interface SerializedDocument {
  schemaVersion: number;
  id: string;
  name: string;
  kind: SwDocument['kind'];
  grid: SwDocument['grid'];
  page: SwDocument['page'];
  legend: SwDocument['legend'];
  meta: SwDocument['meta'];
  nodes: Node[];
  connections: Connection[];
}

export function serializeDocument(doc: SwDocument): SerializedDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    grid: doc.grid,
    page: doc.page,
    legend: doc.legend,
    meta: doc.meta,
    nodes: doc.nodeOrder.map((id) => doc.nodes[id]).filter(Boolean),
    connections: doc.connectionOrder.map((id) => doc.connections[id]).filter(Boolean),
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being migrated *from*. */
const migrations: Record<number, Migration> = {
  0: (raw) => ({ ...raw, schemaVersion: 1 }),
};

export function deserializeDocument(input: unknown): SwDocument {
  let raw = (typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : {}) as Record<
    string,
    unknown
  >;
  let version = Number(raw.schemaVersion ?? 0);
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) break;
    raw = migrate(raw);
    version = Number(raw.schemaVersion ?? version + 1);
  }

  const base = emptyDocument(String(raw.id ?? 'main'), (raw.kind as SwDocument['kind']) ?? 'sheet');
  const doc: SwDocument = {
    ...base,
    name: String(raw.name ?? base.name),
    schemaVersion: SCHEMA_VERSION,
    grid: { ...DEFAULT_GRID, ...(raw.grid as object ?? {}) },
    page: (raw.page as SwDocument['page']) ?? null,
    legend: (raw.legend as SwDocument['legend']) ?? null,
    meta: { ...base.meta, ...((raw.meta as object) ?? {}) },
    nodes: {},
    connections: {},
    nodeOrder: [],
    connectionOrder: [],
  };

  for (const item of (raw.nodes as Node[]) ?? []) {
    const node = normalizeNode(item);
    if (!node) continue;
    doc.nodes[node.id] = node;
    doc.nodeOrder.push(node.id);
  }
  for (const item of (raw.connections as Connection[]) ?? []) {
    const conn = normalizeConnection(item);
    if (!conn) continue;
    doc.connections[conn.id] = conn;
    doc.connectionOrder.push(conn.id);
  }
  return doc;
}

function normalizeNode(raw: Partial<Node> | null): Node | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.componentRef !== 'string') return null;
  return {
    id: raw.id,
    componentRef: raw.componentRef,
    transform: {
      x: Number(raw.transform?.x ?? 0),
      y: Number(raw.transform?.y ?? 0),
      rot: Number(raw.transform?.rot ?? 0),
      scale: Number(raw.transform?.scale ?? 1) || 1,
    },
    size: { w: Number(raw.size?.w ?? 100), h: Number(raw.size?.h ?? 60) },
    params: { ...(raw.params ?? {}) },
    ...(raw.attachment ? { attachment: raw.attachment } : {}),
    z: Number(raw.z ?? 0),
    ...(raw.locked ? { locked: true } : {}),
    ...(raw.hidden ? { hidden: true } : {}),
  };
}

function normalizeConnection(raw: Partial<Connection> | null): Connection | null {
  if (!raw || typeof raw.id !== 'string' || !raw.from || !raw.to) return null;
  return {
    id: raw.id,
    componentRef: raw.componentRef ?? 'base/arrow',
    from: raw.from,
    to: raw.to,
    waypoints: (raw.waypoints ?? []).map((w) => ({ x: Number(w.x), y: Number(w.y) })),
    params: { ...(raw.params ?? {}) },
    z: Number(raw.z ?? 0),
  };
}

export function documentToJson(doc: SwDocument): string {
  return `${JSON.stringify(serializeDocument(doc), null, 2)}\n`;
}
