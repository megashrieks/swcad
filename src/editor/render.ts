import type { ResolvedConnectionInfo, ResolvedNodeInfo } from '@core/model/graph';
import { defAnnotations, resolveAnnotations } from '@core/model/annotations';
import { resolveBinding } from '@core/model/bind';
import type { ComponentDef } from '@core/model/types';
import { parseSvg, sanitize, serialize, treeBounds, elementPoint, findById, type VNode } from '@core/script/svg';
import { layoutMarkdown, markdownChildren, type TextStyle } from '@core/text/markdown';

/** Map fill-slot names to the element ids they control. */
function slotElements(info: ResolvedNodeInfo): Map<string, string> {
  const out = new Map<string, string>();
  for (const [elId, ann] of defAnnotations(info.def)) {
    if (ann.kind === 'fill_slot') out.set(ann.name ?? elId, elId);
  }
  return out;
}

function cloneWith(
  nodes: VNode[],
  overrides: Map<string, Record<string, string>>,
  labels: Record<string, string>,
  hitAreas: Set<string>,
  rich: Record<string, VNode[]> = {},
): VNode[] {
  return nodes.map((node) => {
    const id = node.attrs.id;
    const attrs = { ...node.attrs };
    if (id && overrides.has(id)) Object.assign(attrs, overrides.get(id));
    if (id && hitAreas.has(id)) {
      attrs.fill = attrs.fill && attrs.fill !== 'none' ? attrs.fill : 'transparent';
      attrs['pointer-events'] = 'all';
    }
    // A markdown label is laid out as positioned spans, so it replaces both the element's
    // own text and whatever children the shape declared.
    if (id && rich[id]) return { tag: node.tag, attrs, children: rich[id] };
    const next: VNode = {
      tag: node.tag,
      attrs,
      children: cloneWith(node.children, overrides, labels, hitAreas, rich),
    };
    if (id && labels[id] !== undefined) next.text = labels[id];
    else if (node.text !== undefined) next.text = node.text;
    return next;
  });
}

/**
 * Serialize a resolved node, applying script styles, label bindings and hit areas.
 *
 * `hiddenId` blanks one element without removing it — the inline label editor uses it so
 * the drawn text does not show through the transparent input sitting on top of it.
 */
export function nodeMarkup(info: ResolvedNodeInfo, hiddenId?: string | null): string {
  const slots = slotElements(info);
  const overrides = new Map<string, Record<string, string>>();
  for (const [slot, attrs] of Object.entries(info.styles ?? {})) {
    const elId = slots.get(slot) ?? slot;
    // Declarative styling and a `style()` hook may both name the same element; the hook
    // is applied last, so it is the one that wins attribute by attribute.
    overrides.set(elId, { ...overrides.get(elId), ...attrs });
  }
  if (hiddenId) overrides.set(hiddenId, { ...overrides.get(hiddenId), visibility: 'hidden' });
  const tree = cloneWith(info.vnodes, overrides, info.labels, new Set(info.hitAreas), info.labelNodes);
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
  const params = (scope.params ?? {}) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  const rich: Record<string, VNode[]> = {};
  const overrides = new Map<string, Record<string, string>>();
  for (const [elId, ann] of resolveAnnotations(def, params)) {
    if (ann.kind === 'label') {
      const value = resolveBinding(scope, ann.bind);
      labels[elId] = value;
      const element = findById(tree, elId);
      if (ann.markdown && element?.tag === 'text') {
        const layout = layoutMarkdown(value, previewTextStyle(element.attrs));
        rich[elId] = markdownChildren(layout, elementPoint(element));
      }
    } else if (ann.kind === 'style') {
      const attrs: Record<string, string> = { ...overrides.get(elId) };
      for (const [attr, binding] of Object.entries(ann.attrs ?? {})) {
        const value = resolveBinding(scope, binding);
        if (value !== '') attrs[attr] = value;
      }
      overrides.set(elId, attrs);
    }
  }
  for (const [elId, attrs] of Object.entries(styles)) overrides.set(elId, { ...overrides.get(elId), ...attrs });
  const box = treeBounds(tree);
  return {
    markup: serialize(cloneWith(tree, overrides, labels, new Set(), rich)),
    size: def.defaultSize ?? { w: box.w, h: box.h },
  };
}

/**
 * Base style for a markdown preview. Outside the graph there is no ancestor chain to
 * inherit from, so only the element's own attributes are read.
 */
function previewTextStyle(attrs: Record<string, string>): TextStyle {
  const size = Number(attrs['font-size']);
  return {
    family: attrs['font-family'] ?? 'Inter, Segoe UI, sans-serif',
    monoFamily: 'JetBrains Mono, Consolas, monospace',
    size: Number.isFinite(size) ? size : 12,
    weight: attrs['font-weight'] ?? '400',
    style: attrs['font-style'] ?? 'normal',
    letterSpacing: Number(attrs['letter-spacing']) || 0,
    color: attrs.fill ?? 'var(--sw-ink, #2e3440)',
  };
}
