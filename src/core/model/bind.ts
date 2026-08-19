/**
 * Label bindings.
 *
 * A binding is a dotted path into the render scope (`params.title`, `meta.author`, ...).
 * It may also list alternatives separated by `|`, in which case the first one that
 * resolves to a non-empty value wins:
 *
 *     params.title|meta.title
 *
 * That is how a component gets a *per-instance* field that still falls back to the
 * document: the title block's own param when it has been filled in, the document's
 * metadata otherwise. Edits always write to the first path, so typing into a placed
 * component changes that component and nothing else.
 */

/** The paths a binding may read, in priority order. */
export function bindPaths(bind: string): string[] {
  return bind
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The path an edit should write to. */
export function bindTarget(bind: string): string {
  return bindPaths(bind)[0] ?? bind.trim();
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, source);
}

/** Resolve a binding against `scope`, returning '' when nothing is set. */
export function resolveBinding(scope: unknown, bind: string): string {
  for (const path of bindPaths(bind)) {
    const value = readPath(scope, path);
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text !== '') return text;
  }
  return '';
}
