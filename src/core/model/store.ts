import type { Connection, GridConfig, LegendConfig, Node, PageConfig, SwDocument } from './types';
import { emptyDocument } from './types';

export type ChangeTarget = 'node' | 'connection' | 'doc';

export interface Change {
  target: ChangeTarget;
  id: string;
  before: unknown;
  after: unknown;
}

export interface Transaction {
  label: string;
  changes: Change[];
}

/** How many transactions the undo journal keeps in memory. */
export const HISTORY_LIMIT = 500;

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

type Listener = () => void;
type ChangeListener = (changes: Change[]) => void;

/**
 * Mutable document store with transactions, an undo journal and fine-grained
 * change notification. Entity objects are replaced (not mutated in place) so
 * React selectors can rely on reference identity.
 */
export class DocumentStore {
  private doc: SwDocument;
  private listeners = new Set<Listener>();
  private changeListeners = new Set<ChangeListener>();
  private pending: Change[] | null = null;
  private pendingLabel = '';
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private depth = 0;
  private suppress = false;

  revision = 0;
  /**
   * Bumped whenever the undo or redo stack changes. `revision` alone cannot stand in for
   * it: `pushHistory` records a gesture without touching the document, and undo/redo move
   * entries between the two stacks. Persisting the journal keys off this.
   */
  historyRevision = 0;

  constructor(doc: SwDocument = emptyDocument()) {
    this.doc = doc;
  }

  getDocument(): SwDocument {
    return this.doc;
  }

  replaceDocument(doc: SwDocument): void {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.historyRevision += 1;
    this.revision += 1;
    this.emit([{ target: 'doc', id: '*', before: null, after: null }]);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onChange(fn: ChangeListener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private emit(changes: Change[]): void {
    for (const fn of this.changeListeners) fn(changes);
    for (const fn of this.listeners) fn();
  }

  /** Run mutations as one undoable unit. Nested calls join the outer transaction. */
  transact<T>(label: string, fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth = 1;
    this.pending = [];
    this.pendingLabel = label;
    let result: T;
    try {
      result = fn();
    } catch (err) {
      const failed = this.pending;
      this.pending = null;
      this.depth = 0;
      if (failed && failed.length > 0) this.applyInverse(failed);
      throw err;
    }
    const changes = this.pending ?? [];
    this.pending = null;
    this.depth = 0;
    if (changes.length > 0) {
      if (!this.suppress) {
        this.undoStack.push({ label: this.pendingLabel, changes });
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
        this.historyRevision += 1;
      }
      this.revision += 1;
      this.emit(changes);
    }
    return result;
  }

  private record(change: Change): void {
    if (this.pending) {
      this.pending.push(change);
      return;
    }
    this.transact('edit', () => {
      this.pending!.push(change);
    });
  }

  // ---------------------------------------------------------------- nodes

  addNode(node: Node): Node {
    return this.transact('add node', () => {
      this.doc.nodes = { ...this.doc.nodes, [node.id]: node };
      this.doc.nodeOrder = [...this.doc.nodeOrder, node.id];
      this.record({ target: 'node', id: node.id, before: undefined, after: node });
      return node;
    });
  }

  updateNode(id: string, patch: Partial<Node> | ((n: Node) => Partial<Node>)): Node | null {
    const before = this.doc.nodes[id];
    if (!before) return null;
    return this.transact('update node', () => {
      const delta = typeof patch === 'function' ? patch(before) : patch;
      const after: Node = { ...before, ...delta };
      this.doc.nodes = { ...this.doc.nodes, [id]: after };
      this.record({ target: 'node', id, before, after });
      return after;
    });
  }

  removeNode(id: string): void {
    const before = this.doc.nodes[id];
    if (!before) return;
    this.transact('remove node', () => {
      const nodes = { ...this.doc.nodes };
      delete nodes[id];
      this.doc.nodes = nodes;
      this.doc.nodeOrder = this.doc.nodeOrder.filter((n) => n !== id);
      this.record({ target: 'node', id, before, after: undefined });

      for (const child of Object.values(this.doc.nodes)) {
        if (child.attachment?.parentId === id) {
          this.updateNode(child.id, { attachment: undefined });
        }
      }
      for (const conn of Object.values(this.doc.connections)) {
        const touches =
          (conn.from.kind !== 'free' && conn.from.nodeId === id) ||
          (conn.to.kind !== 'free' && conn.to.nodeId === id);
        if (touches) this.removeConnection(conn.id);
      }
    });
  }

  // ---------------------------------------------------------- connections

  addConnection(conn: Connection): Connection {
    return this.transact('add connection', () => {
      this.doc.connections = { ...this.doc.connections, [conn.id]: conn };
      this.doc.connectionOrder = [...this.doc.connectionOrder, conn.id];
      this.record({ target: 'connection', id: conn.id, before: undefined, after: conn });
      return conn;
    });
  }

  updateConnection(
    id: string,
    patch: Partial<Connection> | ((c: Connection) => Partial<Connection>),
  ): Connection | null {
    const before = this.doc.connections[id];
    if (!before) return null;
    return this.transact('update connection', () => {
      const delta = typeof patch === 'function' ? patch(before) : patch;
      const after: Connection = { ...before, ...delta };
      this.doc.connections = { ...this.doc.connections, [id]: after };
      this.record({ target: 'connection', id, before, after });
      return after;
    });
  }

  removeConnection(id: string): void {
    const before = this.doc.connections[id];
    if (!before) return;
    this.transact('remove connection', () => {
      const connections = { ...this.doc.connections };
      delete connections[id];
      this.doc.connections = connections;
      this.doc.connectionOrder = this.doc.connectionOrder.filter((c) => c !== id);
      this.record({ target: 'connection', id, before, after: undefined });
    });
  }

  // ------------------------------------------------------------ doc level

  private setDocField<K extends keyof SwDocument>(key: K, value: SwDocument[K], label: string): void {
    const before = this.doc[key];
    if (before === value) return;
    this.transact(label, () => {
      this.doc[key] = value;
      this.record({ target: 'doc', id: String(key), before, after: value });
    });
  }

  setGrid(patch: Partial<GridConfig>): void {
    this.setDocField('grid', { ...this.doc.grid, ...patch }, 'grid settings');
  }

  setPage(page: PageConfig | null): void {
    this.setDocField('page', page, 'page settings');
  }

  setLegend(legend: LegendConfig | null): void {
    this.setDocField('legend', legend, 'legend settings');
  }

  setMeta(patch: Record<string, unknown>): void {
    this.setDocField('meta', { ...this.doc.meta, ...patch } as SwDocument['meta'], 'document info');
  }

  setName(name: string): void {
    this.setDocField('name', name, 'rename');
  }

  setNodeOrder(order: string[]): void {
    this.setDocField('nodeOrder', order, 'reorder');
  }

  // ------------------------------------------------------------ undo/redo

  private applyInverse(changes: Change[]): void {
    for (let i = changes.length - 1; i >= 0; i -= 1) this.applyChange(changes[i], 'before');
  }

  private applyChange(change: Change, side: 'before' | 'after'): void {
    const value = side === 'before' ? change.before : change.after;
    if (change.target === 'node') {
      const nodes = { ...this.doc.nodes };
      if (value === undefined) {
        delete nodes[change.id];
        this.doc.nodeOrder = this.doc.nodeOrder.filter((n) => n !== change.id);
      } else {
        if (!nodes[change.id] && !this.doc.nodeOrder.includes(change.id)) {
          this.doc.nodeOrder = [...this.doc.nodeOrder, change.id];
        }
        nodes[change.id] = value as Node;
      }
      this.doc.nodes = nodes;
      return;
    }
    if (change.target === 'connection') {
      const conns = { ...this.doc.connections };
      if (value === undefined) {
        delete conns[change.id];
        this.doc.connectionOrder = this.doc.connectionOrder.filter((c) => c !== change.id);
      } else {
        if (!conns[change.id] && !this.doc.connectionOrder.includes(change.id)) {
          this.doc.connectionOrder = [...this.doc.connectionOrder, change.id];
        }
        conns[change.id] = value as Connection;
      }
      this.doc.connections = conns;
      return;
    }
    if (change.id !== '*') {
      (this.doc as unknown as Record<string, unknown>)[change.id] = value;
    }
  }

  /** Apply mutations without recording an undo entry (drag previews). */
  silent<T>(fn: () => T): T {
    const previous = this.suppress;
    this.suppress = true;
    try {
      return this.transact('transient', fn);
    } finally {
      this.suppress = previous;
    }
  }

  /** Push a hand-built undo entry, e.g. one entry for a whole drag gesture. */
  pushHistory(label: string, changes: Change[]): void {
    if (changes.length === 0) return;
    this.undoStack.push({ label, changes });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.historyRevision += 1;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const txn = this.undoStack.pop();
    if (!txn) return;
    this.suppress = true;
    for (let i = txn.changes.length - 1; i >= 0; i -= 1) this.applyChange(txn.changes[i], 'before');
    this.suppress = false;
    this.redoStack.push(txn);
    this.historyRevision += 1;
    this.revision += 1;
    this.emit(txn.changes);
  }

  redo(): void {
    const txn = this.redoStack.pop();
    if (!txn) return;
    this.suppress = true;
    for (const change of txn.changes) this.applyChange(change, 'after');
    this.suppress = false;
    this.undoStack.push(txn);
    this.historyRevision += 1;
    this.revision += 1;
    this.emit(txn.changes);
  }

  undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** The journal as plain data, newest entries last, for writing to disk. */
  exportHistory(limit = HISTORY_LIMIT): { undo: Transaction[]; redo: Transaction[] } {
    return { undo: this.undoStack.slice(-limit), redo: this.redoStack.slice(-limit) };
  }

  /**
   * Adopt a journal read back from disk. The document is *not* touched — the caller has
   * already loaded the matching sheet — so this does not mark anything dirty; it only
   * wakes listeners up so the undo buttons stop looking empty.
   */
  importHistory(undo: Transaction[], redo: Transaction[]): void {
    this.undoStack = undo.slice(-HISTORY_LIMIT);
    this.redoStack = redo.slice(-HISTORY_LIMIT);
    this.historyRevision += 1;
    for (const fn of this.listeners) fn();
  }

  /** Notify listeners without recording history (used for transient drag previews). */
  touch(): void {
    this.revision += 1;
    for (const fn of this.listeners) fn();
  }
}
