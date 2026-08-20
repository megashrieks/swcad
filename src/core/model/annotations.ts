import type { Annotation, AnnotationEntry, ComponentDef } from './types';

/**
 * Reading annotations off a component.
 *
 * Two things make an annotation more than a plain record. It may be a *list* — one element
 * can be painted from a parameter and be connectable at the same time — and its fields may
 * be written as `{{params.name}}`, so a part like `meta/port` is one drawing whose meaning
 * follows the instance you placed. Everything that looks at annotations goes through here,
 * so the drawing pipeline and the component compiler always read them the same way.
 */

/** Every annotation of a component, flattened to `[element id, annotation]` pairs. */
export function annotationEntries(
  annotations: Record<string, AnnotationEntry> | undefined | null,
): [string, Annotation][] {
  const out: [string, Annotation][] = [];
  for (const [elId, entry] of Object.entries(annotations ?? {})) {
    if (Array.isArray(entry)) for (const ann of entry) out.push([elId, ann]);
    else if (entry) out.push([elId, entry]);
  }
  return out;
}

/** Same, straight off a definition. */
export function defAnnotations(def: ComponentDef | null | undefined): [string, Annotation][] {
  return annotationEntries(def?.annotations);
}

/** Add one annotation to a table, keeping any already recorded against that element. */
export function addAnnotation(
  table: Record<string, AnnotationEntry>,
  elId: string,
  annotation: Annotation,
): void {
  const existing = table[elId];
  if (existing === undefined) table[elId] = annotation;
  else if (Array.isArray(existing)) existing.push(annotation);
  else table[elId] = [existing, annotation];
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([\w.]+)\s*\}\}$/;

function lookup(scope: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, scope);
}

/**
 * Fill an annotation's `{{params.x}}` placeholders from the instance.
 *
 * A field written as nothing but a placeholder takes the value's own type — `min` stays a
 * number, `facing` stays a pair — while a placeholder inside a longer string interpolates.
 * A missing value leaves an empty string behind, which is how an unset parameter switches
 * its annotation off (see `isAnnotationLive`).
 */
export function applyParams<T>(value: T, params: Record<string, unknown>): T {
  const scope = { params };
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const whole = WHOLE.exec(input);
      if (whole) {
        const found = lookup(scope, whole[1]);
        return found === undefined || found === null ? '' : found;
      }
      return input.replace(PLACEHOLDER, (_, path: string) => {
        const found = lookup(scope, path);
        return found === undefined || found === null ? '' : String(found);
      });
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, walk(v)]));
    }
    return input;
  };
  return walk(value) as T;
}

/**
 * Whether a filled-in annotation still says anything. A port with no name, an anchor with
 * no name or a label bound to nothing came from a parameter left blank — the author is
 * saying "this shape is not one of those", so it is dropped rather than half-applied.
 */
export function isAnnotationLive(ann: Annotation): boolean {
  if (ann.kind === 'port' || ann.kind === 'anchor' || ann.kind === 'fill_slot') return Boolean(ann.name);
  if (ann.kind === 'label') return Boolean(ann.bind);
  if (ann.kind === 'style') return Object.keys(ann.attrs ?? {}).length > 0;
  return true;
}

/** The annotations of one instance: placeholders filled in, blank ones dropped. */
export function resolveAnnotations(
  def: ComponentDef | null | undefined,
  params: Record<string, unknown>,
): [string, Annotation][] {
  const out: [string, Annotation][] = [];
  for (const [elId, ann] of defAnnotations(def)) {
    const filled = applyParams(ann, params);
    if (isAnnotationLive(filled)) out.push([elId, filled]);
  }
  return out;
}

/** Whether an annotation is re-exported when its component is flattened into another. */
export function isInherited(ann: Annotation): boolean {
  if (ann.inherit !== undefined) return ann.inherit;
  return ann.kind !== 'label' && ann.kind !== 'style';
}
