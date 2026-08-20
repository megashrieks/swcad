import type { Rect } from '../geometry/index';
import { rect, rectUnion, rotate } from '../geometry/index';
import { deserializeDocument } from '../io/serialize';
import { addAnnotation, isInherited, resolveAnnotations } from '../model/annotations';
import { bindTarget } from '../model/bind';
import { GraphEngine, type ResolvedNodeInfo } from '../model/graph';
import { DocumentStore } from '../model/store';
import type { Annotation, AnnotationEntry, ComponentDef } from '../model/types';
import { serialize, treeBounds, type VNode } from '../script/svg';
import type { LibraryRegistry } from './registry';

/**
 * Flattening a component's document into the thing the runtime draws.
 *
 * A component is a project: you draw it out of other components, the same way you draw a
 * sheet. Placing it somewhere, though, has to end up as one shape with one set of ports —
 * so the document is *compiled*, once, into the SVG and annotations every other part of
 * the app already understands. Nothing downstream knows the difference between a component
 * that was drawn and one that was typed.
 *
 * The rules are short:
 *
 * - Every node is drawn where the document puts it, with the whole drawing shifted so its
 *   top-left corner is the origin. That corner is what a placed instance sits on.
 * - What a node *means* travels with it: a port drawn inside a component is a port of the
 *   component. Annotations that only describe the drawing (styling, fixed text) are baked
 *   in instead — see `isInherited`.
 * - Ids are prefixed with the node they came from, so two copies of the same part keep
 *   their own ports.
 */

export interface CompiledDrawing {
  source: string;
  annotations: Record<string, AnnotationEntry>;
  size: { w: number; h: number };
  /** Components the document draws from, as `lib/id` refs. */
  uses: string[];
  errors: string[];
}

/** Element ids are namespaced by the node that contributed them. */
const elementId = (nodeId: string, elId: string): string => `${nodeId}-${elId}`;

/** Round coordinates written into a file people read. */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The transform placing one node's drawing in the document, written the way an SVG element
 * wants it. It goes on each of the node's own elements rather than on a group around them,
 * because an annotation is looked up by element id and reads that element's transform —
 * a group's would be invisible to it.
 */
function placement(info: ResolvedNodeInfo, origin: { x: number; y: number }): string {
  const t = info.effective;
  const parts: string[] = [];
  const x = r3(t.x - origin.x);
  const y = r3(t.y - origin.y);
  if (x || y) parts.push(`translate(${x} ${y})`);
  if (t.rot) {
    const px = r3((t.pivot?.x ?? 0) * t.scale);
    const py = r3((t.pivot?.y ?? 0) * t.scale);
    parts.push(px || py ? `rotate(${r3(t.rot)} ${px} ${py})` : `rotate(${r3(t.rot)})`);
  }
  if (t.scale !== 1) parts.push(`scale(${r3(t.scale)})`);
  return parts.join(' ');
}

/**
 * One node's drawing, ready to be dropped into the component: styled, with baked-in text
 * where the text is not the outer component's business, ids namespaced, and the node's
 * placement folded into the top-level elements.
 */
function flatten(
  info: ResolvedNodeInfo,
  origin: { x: number; y: number },
  bakedLabels: Record<string, string>,
  keep: ((elId: string) => boolean) | null,
): VNode[] {
  const transform = placement(info, origin);
  const styles = info.styles ?? {};
  const walk = (node: VNode, top: boolean): VNode => {
    const attrs = { ...node.attrs };
    const id = attrs.id;
    if (id) {
      Object.assign(attrs, styles[id] ?? {});
      attrs.id = elementId(info.id, id);
    }
    if (top && transform) attrs.transform = attrs.transform ? `${transform} ${attrs.transform}` : transform;
    // A markdown label is already laid out as positioned spans; those spans *are* the text.
    const spans = id !== undefined ? info.labelNodes[id] : undefined;
    if (spans) return { tag: node.tag, attrs, children: spans };
    const out: VNode = { tag: node.tag, attrs, children: node.children.map((child) => walk(child, false)) };
    const text = id !== undefined ? bakedLabels[id] : undefined;
    if (text !== undefined) out.text = text;
    else if (node.text !== undefined) out.text = node.text;
    return out;
  };
  const roots = keep ? info.vnodes.filter((node) => node.attrs.id !== undefined && keep(node.attrs.id)) : info.vnodes;
  return roots.map((node) => walk(node, true));
}

/** Re-aim a port's facing: the node's own rotation is part of the drawing once flattened. */
function worldFacing(ann: Annotation & { kind: 'port' }, info: ResolvedNodeInfo): [number, number] | undefined {
  if (!ann.facing) return undefined;
  const local = { x: Number(ann.facing[0]) || 0, y: Number(ann.facing[1]) || 0 };
  const aimed = info.effective.rot ? rotate(local, info.effective.rot) : local;
  return [r3(aimed.x), r3(aimed.y)];
}

/**
 * Compile a component document. `registry` supplies the components it draws from, so
 * anything the document uses must already be loaded (and, if it is drawn too, already
 * compiled — see `compileLibraries`).
 */
export function compileDocument(raw: unknown, registry: LibraryRegistry): CompiledDrawing {
  const doc = deserializeDocument(raw);
  const store = new DocumentStore(doc);
  const engine = new GraphEngine(store, registry);
  const graph = engine.resolve();

  const errors: string[] = [];
  const uses = new Set<string>();
  const drawn = [...graph.nodes.values()]
    .filter((info) => !info.node.hidden)
    .sort((a, b) => a.node.z - b.node.z || doc.nodeOrder.indexOf(a.id) - doc.nodeOrder.indexOf(b.id));
  const links = [...graph.connections.values()].sort((a, b) => a.conn.z - b.conn.z);

  let box: Rect | null = null;
  for (const info of drawn) {
    uses.add(info.node.componentRef);
    if (info.error) errors.push(`${info.node.componentRef}: ${info.error}`);
    // A marker is a place, not a picture: a port drawn on the edge of a box must not push
    // the box's own extent outwards by the size of the pin that shows where it is.
    if (info.def?.marker) continue;
    if (info.bounds.w > 0 || info.bounds.h > 0) box = box ? rectUnion(box, info.bounds) : info.bounds;
  }
  for (const link of links) {
    uses.add(link.conn.componentRef);
    const b = treeBounds(link.vnodes);
    if (b.w > 0 || b.h > 0) box = box ? rectUnion(box, b) : b;
  }
  const bounds = box ?? rect(0, 0, 0, 0);
  const origin = { x: bounds.x, y: bounds.y };

  const annotations: Record<string, AnnotationEntry> = {};
  const tree: VNode[] = [];

  for (const info of drawn) {
    // Text that follows the *outer* component stays a binding; text that was typed into
    // this drawing is part of the drawing, so it is written out as it reads.
    const baked: Record<string, string> = {};
    const carries = new Set<string>();
    for (const [elId, ann] of resolveAnnotations(info.def, info.node.params)) {
      if (ann.kind === 'label' && !isInherited(ann)) baked[elId] = info.labels[elId] ?? '';
      if (!isInherited(ann)) continue;
      carries.add(elId);
      const key = elementId(info.id, elId);
      if (ann.kind === 'port') {
        const facing = worldFacing(ann, info);
        addAnnotation(annotations, key, { ...ann, ...(facing ? { facing } : {}) });
      } else if (ann.kind === 'label') {
        // Only the path an edit would write to survives: a sample value is scaffolding
        // for the bench, not something the placed component should fall back to.
        addAnnotation(annotations, key, { ...ann, bind: bindTarget(ann.bind), inherit: undefined });
      } else {
        addAnnotation(annotations, key, { ...ann, inherit: undefined });
      }
    }
    // Everything a marker draws is there to make it findable while you are placing it.
    // What survives is the one element the annotation is attached to.
    tree.push(...flatten(info, origin, baked, info.def?.marker ? (elId) => carries.has(elId) : null));
  }

  // Connectors drawn inside a component are part of the picture and nothing more: they
  // are already routed, so they are baked exactly as they were resolved.
  for (const link of links) {
    const move = origin.x || origin.y ? `translate(${r3(-origin.x)} ${r3(-origin.y)})` : '';
    for (const vnode of link.vnodes) {
      const attrs = { ...vnode.attrs };
      if (attrs.id) attrs.id = elementId(link.id, attrs.id);
      if (move) attrs.transform = attrs.transform ? `${move} ${attrs.transform}` : move;
      tree.push({ ...vnode, attrs });
    }
  }

  return {
    source: serialize(tree),
    annotations,
    size: { w: r3(bounds.w), h: r3(bounds.h) },
    uses: [...uses],
    errors,
  };
}

/** A definition with its drawing compiled in, or the definition itself when it is typed. */
export function compileDefinition(def: ComponentDef, registry: LibraryRegistry): ComponentDef {
  if (!def.document) return def;
  const drawing = compileDocument(def.document, registry);
  return {
    ...def,
    geometry: { type: 'svg', source: drawing.source },
    annotations: drawing.annotations,
    defaultSize: def.defaultSize ?? (drawing.size.w > 0 ? drawing.size : undefined),
  };
}

/** What a document draws from, read straight off the file — no compiling needed to find out. */
function documentRefs(raw: unknown): string[] {
  const doc = (raw ?? {}) as { nodes?: unknown; connections?: unknown };
  const refs = new Set<string>();
  for (const list of [doc.nodes, doc.connections]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const ref = (item as { componentRef?: unknown })?.componentRef;
      if (typeof ref === 'string' && ref) refs.add(ref);
    }
  }
  return [...refs];
}

/**
 * Compile every drawn component in the registry, deepest first.
 *
 * A drawing may use components that are themselves drawings, so each one is compiled only
 * after the ones it draws from. A component that (directly or not) draws from itself is
 * dropped to an empty drawing with the loop reported, rather than being followed forever.
 */
export function compileLibraries(registry: LibraryRegistry): { ref: string; message: string }[] {
  const drawn = new Map(registry.all().filter((entry) => entry.def.document).map((entry) => [entry.ref, entry]));
  if (drawn.size === 0) return [];

  const problems: { ref: string; message: string }[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const compile = (ref: string): void => {
    const entry = drawn.get(ref);
    if (!entry || done.has(ref)) return;
    if (visiting.has(ref)) {
      problems.push({ ref, message: 'draws from itself' });
      done.add(ref);
      registry.upsert(entry.libId, { ...entry.def, geometry: { type: 'svg', source: '' }, annotations: {} }, entry.scriptSource);
      return;
    }
    visiting.add(ref);
    for (const used of documentRefs(entry.def.document)) {
      const resolved = registry.get(used);
      if (resolved && resolved.ref !== ref) compile(resolved.ref);
    }
    visiting.delete(ref);
    done.add(ref);
    try {
      const drawing = compileDocument(entry.def.document, registry);
      for (const message of drawing.errors) problems.push({ ref, message });
      registry.upsert(
        entry.libId,
        {
          ...entry.def,
          geometry: { type: 'svg', source: drawing.source },
          annotations: drawing.annotations,
          defaultSize: entry.def.defaultSize ?? (drawing.size.w > 0 ? drawing.size : undefined),
        },
        entry.scriptSource,
      );
    } catch (err) {
      problems.push({ ref, message: err instanceof Error ? err.message : String(err) });
    }
  };

  registry.batch(() => {
    for (const ref of drawn.keys()) compile(ref);
  });
  return problems;
}
