import type { ResolvedConnectionInfo, ResolvedNodeInfo } from '@core/model/graph';
import { resolveBinding } from '@core/model/bind';
import type { ComponentDef } from '@core/model/types';
import { parseSvg, sanitize, serialize, treeBounds, type VNode } from '@core/script/svg';

/** Map fill-slot names to the element ids they control. */
function slotElements(info: ResolvedNodeInfo): Map<string, string> {
  const out = new Map<string, string>();
  for (const [elId, ann] of Object.entries(info.def?.annotations ?? {})) {
    if (ann.kind === 'fill_slot') out.set(ann.name ?? elId, elId);
  }
  return out;
}

function cloneWith(
  nodes: VNode[],
  overrides: Map<string, Record<string, string>>,
  labels: Record<string, string>,
  hitAreas: Set<string>,
): VNode[] {
  return nodes.map((node) => {
    const id = node.attrs.id;
    const attrs = { ...node.attrs };
    if (id && overrides.has(id)) Object.assign(attrs, overrides.get(id));
    if (id && hitAreas.has(id)) {
      attrs.fill = attrs.fill && attrs.fill !== 'none' ? attrs.fill : 'transparent';
      attrs['pointer-events'] = 'all';
    }
    const next: VNode = {
      tag: node.tag,
      attrs,
      children: cloneWith(node.children, overrides, labels, hitAreas),
    };
    if (id && labels[id] !== undefined) next.text = labels[id];
    else if (node.text !== undefined) next.text = node.text;
    return next;
  });
}

/** Serialize a resolved node, applying script styles, label bindings and hit areas. */
export function nodeMarkup(info: ResolvedNodeInfo): string {
  const slots = slotElements(info);
  const overrides = new Map<string, Record<string, string>>();
  for (const [slot, attrs] of Object.entries(info.styles ?? {})) {
    const elId = slots.get(slot) ?? slot;
    overrides.set(elId, attrs);
  }
  const tree = cloneWith(info.vnodes, overrides, info.labels, new Set(info.hitAreas));
  return serialize(tree);
}

export function connectionMarkup(info: ResolvedConnectionInfo): string {
  return serialize(info.vnodes);
}

/** SVG transform string for a node: translate, rotate about the instance centre, and any uniform user-set scale. Resize is baked into the scaled geometry itself (see `scaleGeometry`), not into this transform, so strokes and text never stretch. */
export function nodeTransform(info: ResolvedNodeInfo): string {
  const t = info.effective;
  const parts = [`translate(${round(t.x)} ${round(t.y)})`];
  if (t.rot) {
    const px = round((t.pivot?.x ?? 0) * t.scale);
    const py = round((t.pivot?.y ?? 0) * t.scale);
    parts.push(px || py ? `rotate(${round(t.rot)} ${px} ${py})` : `rotate(${round(t.rot)})`);
  }
  if (t.scale !== 1) parts.push(`scale(${round(t.scale)})`);
  return parts.join(' ');
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Render a component definition outside the graph (legend, palette previews,
 * component editor preview) with label bindings resolved against `scope`.
 */
export function staticMarkup(
  def: ComponentDef | null | undefined,
  scope: Record<string, unknown>,
  styles: Record<string, Record<string, string>> = {},
): { markup: string; size: { w: number; h: number } } {
  if (!def) return { markup: '', size: { w: 0, h: 0 } };
  const tree = sanitize(parseSvg(def.geometry?.source ?? ''));
  const labels: Record<string, string> = {};
  for (const [elId, ann] of Object.entries(def.annotations ?? {})) {
    if (ann.kind !== 'label') continue;
    labels[elId] = resolveBinding(scope, ann.bind);
  }
  const overrides = new Map<string, Record<string, string>>();
  for (const [elId, attrs] of Object.entries(styles)) overrides.set(elId, attrs);
  const box = treeBounds(tree);
  return {
    markup: serialize(cloneWith(tree, overrides, labels, new Set())),
    size: def.defaultSize ?? { w: box.w, h: box.h },
  };
}
