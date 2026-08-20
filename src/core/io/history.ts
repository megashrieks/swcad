import type { Change, ChangeTarget, Transaction } from '../model/store';

export const HISTORY_SCHEMA_VERSION = 1;

/** Transactions kept on disk per stack. The in-memory journal may be longer. */
export const HISTORY_MAX_ENTRIES = 200;

/** Ceiling for the journal file. A single drag of many nodes can be sizeable. */
export const HISTORY_MAX_BYTES = 1024 * 1024;

export interface StoredHistory {
  schemaVersion: number;
  /** Fingerprint of the sheet file this journal belongs to. */
  doc: string;
  undo: Transaction[];
  redo: Transaction[];
}

/**
 * Where a sheet's undo journal lives. It sits in a dotted folder rather than beside the
 * sheet so a project folder stays readable: `sheets/main.sheet.json` becomes
 * `.swcad/history/sheets__main.sheet.history.json`.
 */
export function historyPath(root: string, sheetPath: string): string {
  const slug = sheetPath
    .replace(/\.json$/i, '')
    .replace(/[\\/]+/g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Dots are kept so `main.sheet` stays readable, but never two in a row: the file
    // name is derived from a path and must not be able to climb out of the folder.
    .replace(/\.{2,}/g, '_');
  return `${root}/.swcad/history/${slug || 'sheet'}.history.json`;
}

/**
 * Cheap content hash (FNV-1a paired with djb2, so a collision needs both to agree).
 * The journal replays recorded `before` values into the document, which is only sound
 * if the document on disk is still the one those values were recorded against.
 */
export function fingerprint(text: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = (Math.imul(djb, 33) + code) | 0;
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(fnv)}${hex(djb)}-${text.length.toString(16)}`;
}

/**
 * Serialise the journal, trimming the oldest entries until it fits `maxBytes`. Losing the
 * far end of the history is the right failure mode: recent steps are the ones anyone undoes.
 */
export function encodeHistory(
  docJson: string,
  history: { undo: Transaction[]; redo: Transaction[] },
  maxBytes = HISTORY_MAX_BYTES,
): string {
  const doc = fingerprint(docJson);
  let undo = history.undo.slice(-HISTORY_MAX_ENTRIES);
  let redo = history.redo.slice(-HISTORY_MAX_ENTRIES);
  for (;;) {
    const text = `${JSON.stringify({ schemaVersion: HISTORY_SCHEMA_VERSION, doc, undo, redo })}\n`;
    if (text.length <= maxBytes || undo.length + redo.length === 0) return text;
    // Redo goes first: it is the branch you already stepped away from.
    if (redo.length > 0) redo = redo.slice(Math.max(1, Math.ceil(redo.length / 8)));
    else undo = undo.slice(Math.max(1, Math.ceil(undo.length / 8)));
  }
}

/**
 * Read a journal back. Returns null when the file is unusable — corrupt, from a future
 * schema, or recorded against a different version of the sheet (someone edited the JSON
 * by hand). A dropped journal only costs undo depth; a mismatched one would corrupt the
 * document, so anything doubtful is discarded.
 */
export function decodeHistory(text: string, docJson: string): { undo: Transaction[]; redo: Transaction[] } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const stored = raw as Partial<StoredHistory>;
  if (stored.schemaVersion !== HISTORY_SCHEMA_VERSION) return null;
  if (stored.doc !== fingerprint(docJson)) return null;
  const undo = transactions(stored.undo);
  const redo = transactions(stored.redo);
  if (!undo || !redo) return null;
  return { undo, redo };
}

const TARGETS: ChangeTarget[] = ['node', 'connection', 'doc'];

function transactions(input: unknown): Transaction[] | null {
  if (!Array.isArray(input)) return null;
  const out: Transaction[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null;
    const txn = item as Partial<Transaction>;
    if (typeof txn.label !== 'string' || !Array.isArray(txn.changes)) return null;
    const changes: Change[] = [];
    for (const entry of txn.changes) {
      if (typeof entry !== 'object' || entry === null) return null;
      const change = entry as Partial<Change>;
      if (typeof change.id !== 'string') return null;
      if (!TARGETS.includes(change.target as ChangeTarget)) return null;
      // `before`/`after` are absent rather than null for adds and removes: JSON drops
      // undefined, and `applyChange` reads that absence as "the entity did not exist".
      changes.push({ target: change.target as ChangeTarget, id: change.id, before: change.before, after: change.after });
    }
    if (changes.length > 0) out.push({ label: txn.label, changes });
  }
  return out;
}
