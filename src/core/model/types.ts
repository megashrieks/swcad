import type { Rect, Transform, Vec } from '../geometry/index';

export type AnnotationKind = 'port' | 'label' | 'handle' | 'fill_slot' | 'anchor' | 'hit_area' | 'style';

export type PortDirection = 'in' | 'out' | 'inout' | 'none';

/**
 * Fields every annotation may carry.
 *
 * `inherit` decides what happens when the component is *flattened into another one* —
 * a component is a document, so anything you draw may itself be made of components:
 *
 * - `true`  the annotation is re-exported, so a port drawn inside a component is a port
 *           of the component that contains it.
 * - `false` the annotation is consumed: its effect is baked into the drawing and the
 *           outer component never hears about it (fixed text, styling).
 *
 * Ports, anchors, handles and hit areas default to `true`; labels and styling to `false`.
 */
interface AnnotationBase {
  inherit?: boolean;
}

export interface PortAnnotation extends AnnotationBase {
  kind: 'port';
  name: string;
  direction?: PortDirection;
  /** Outward normal in local space; drives connector exit direction. */
  facing?: [number, number];
  /**
   * `point` (the default) terminates connectors at the element's anchor point.
   * `outline` makes the element's whole drawn edge connectable, so a connector
   * lands wherever it meets the stroke.
   */
  surface?: 'point' | 'outline';
  accepts?: string[];
  max?: number;
}

export interface LabelAnnotation extends AnnotationBase {
  kind: 'label';
  name?: string;
  /** Dotted path into the render context, e.g. `params.title` or `node.id`. */
  bind: string;
  align?: 'start' | 'center' | 'end';
  editable?: boolean;
  /**
   * Render the bound value as Markdown (see `core/text/markdown.ts`) instead of as a single
   * run of text. Only meaningful on a `<text>` element, whose children it replaces.
   */
  markdown?: boolean;
}

export interface HandleAnnotation extends AnnotationBase {
  kind: 'handle';
  name?: string;
  /** Params driven by dragging this handle, in [x, y] order. */
  drives: string[];
  axis?: 'x' | 'y' | 'both' | 'radial';
  min?: number;
  max?: number;
}

export interface FillSlotAnnotation extends AnnotationBase {
  kind: 'fill_slot';
  name: string;
}

export interface AnchorAnnotation extends AnnotationBase {
  kind: 'anchor';
  name: string;
}

export interface HitAreaAnnotation extends AnnotationBase {
  kind: 'hit_area';
  name?: string;
}

/**
 * Attributes driven by the instance rather than fixed in the drawing: `{ "fill":
 * "params.fill" }` paints the element with whatever the `fill` parameter says. Each value
 * is a binding (see `bind.ts`); an attribute whose binding resolves to nothing keeps the
 * value the drawing gave it, so a parameter left blank is a parameter that does not apply.
 *
 * This is what a `style()` script hook does, without the script.
 */
export interface StyleAnnotation extends AnnotationBase {
  kind: 'style';
  attrs: Record<string, string>;
}

export type Annotation =
  | PortAnnotation
  | LabelAnnotation
  | HandleAnnotation
  | FillSlotAnnotation
  | AnchorAnnotation
  | HitAreaAnnotation
  | StyleAnnotation;

/**
 * What an element means. One element may mean several things at once — a rectangle can be
 * painted from a parameter *and* be connectable along its edge — so a list is allowed
 * anywhere a single annotation is.
 */
export type AnnotationEntry = Annotation | Annotation[];

export type ParamType = 'number' | 'string' | 'boolean' | 'color' | 'enum';

export interface ParamDef {
  name: string;
  type: ParamType;
  label?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /**
   * A `string` param whose value is a list rather than a phrase, edited in a box with room
   * for several lines. A UML class is the case that asked for it: its attributes and its
   * operations are one parameter each, and a one-line field cannot hold a newline, so
   * without this the only way to write a member list is a separator character.
   */
  multiline?: boolean;
  /**
   * Kept out of the inspector. For values that are edited on the drawing itself — a
   * markdown text block is typed into the canvas, not into a one-line param field.
   */
  hidden?: boolean;
}

export interface ComponentDef {
  id: string;
  name: string;
  version: string;
  category?: string;
  description?: string;
  /** true for connector-style components (arrows) driven by two endpoints. */
  connector?: boolean;
  params: ParamDef[];
  geometry: { type: 'svg'; source: string };
  annotations: Record<string, AnnotationEntry>;
  /** Relative path to the script inside the library, e.g. `scripts/box.js`. */
  script?: string;
  defaultSize?: { w: number; h: number };
  resizable?: boolean;
  /**
   * Local point a rotation turns about. Rotation otherwise turns about the middle of the
   * instance box, which is the middle of the drawing only for a component that fills that
   * box — a script that hugs its content, or one that hangs its artwork off the node's
   * origin, is instead carried around a point outside itself, and a quarter turn reads as
   * an orbit rather than a turn.
   *
   * Naming the point is left to the author because only the author knows which part should
   * hold still: for a symbol whose port is the thing being aimed at, that is the port, and
   * keeping it fixed also keeps it on the grid it was snapped to.
   */
  pivot?: { x: number; y: number };
  /**
   * Contributes a point rather than a picture: a port, an anchor, a resize grip. Drawn in
   * full while you are placing it, but when the component it was drawn into is compiled it
   * keeps only what it annotates, and it never counts towards that component's extent.
   */
  marker?: boolean;
  /**
   * The drawing as a document, for components that are drawn rather than typed. Present
   * exactly when the package has a `document.json`; `geometry` and `annotations` are then
   * produced from it by the compiler (`core/library/compile.ts`) once the libraries the
   * document draws from have loaded.
   */
  document?: unknown;
}

export interface LibraryManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Optional palette ordering hint; components are discovered by scanning. */
  components?: string[];
  shared?: string[];
  /**
   * Parts rather than finished components: offered while drawing a component, hidden on
   * a sheet. `libs/meta` is the one that ships.
   */
  editorOnly?: boolean;
}

/**
 * Where a component's files live, handed over by the server exactly as they are on
 * disk. `package` components are folders (`component.json` + `shape.svg` + …);
 * `legacy` ones are a single pre-compiled `.comp.json` that predates the format.
 */
export interface ComponentSource {
  id: string;
  format: 'package' | 'legacy';
  /** Path relative to the app root, e.g. `libs/base/components/box`. */
  dir: string;
  /** Only set for legacy single-file components. */
  file?: string;
  /** File name inside the package → its text. */
  files: Record<string, string>;
}

export interface LoadedLibrary {
  manifest: LibraryManifest;
  components: Record<string, ComponentDef>;
  scripts: Record<string, string>;
  shared: Record<string, string>;
  /** Raw package files, keyed by component id. */
  sources?: Record<string, ComponentSource>;
  /** Per-component load failures, keyed by path. */
  errors?: Record<string, string>;
  dir: string;
  readOnly?: boolean;
  error?: string;
}

export interface Attachment {
  parentId: string;
  anchorId: string;
  offset: Vec;
}

export interface Node {
  id: string;
  componentRef: string;
  transform: Transform;
  size: { w: number; h: number };
  params: Record<string, unknown>;
  attachment?: Attachment;
  z: number;
  locked?: boolean;
  hidden?: boolean;
}

export type Endpoint =
  | { kind: 'port'; nodeId: string; portId: string }
  | { kind: 'anchor'; nodeId: string; anchorId: string }
  | { kind: 'free'; x: number; y: number };

export interface Connection {
  id: string;
  componentRef: string;
  from: Endpoint;
  to: Endpoint;
  waypoints: Vec[];
  params: Record<string, unknown>;
  z: number;
}

export interface GridConfig {
  size: number;
  subdivisions: number;
  origin: Vec;
  unit: 'px' | 'mm';
  visible: boolean;
  snap: boolean;
}

export interface PageConfig {
  preset: string;
  /** Page size in millimetres. */
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  margin: number;
  frame: boolean;
  zones: boolean;
  /** World units per millimetre. */
  scale: number;
}

export interface LegendField {
  key: string;
  label: string;
  value: string;
}

export interface LegendConfig {
  componentRef: string;
  fields: Record<string, string>;
}

export interface DocumentMeta {
  title: string;
  author: string;
  revision: string;
  sheetNumber?: number;
  sheetCount?: number;
  date?: string;
  [key: string]: unknown;
}

export interface SwDocument {
  id: string;
  name: string;
  kind: 'sheet' | 'component-draft';
  schemaVersion: number;
  grid: GridConfig;
  page: PageConfig | null;
  legend: LegendConfig | null;
  meta: DocumentMeta;
  nodes: Record<string, Node>;
  connections: Record<string, Connection>;
  nodeOrder: string[];
  connectionOrder: string[];
}

/** Resolved geometry for a node, produced by the render pipeline. */
export interface ResolvedPort {
  id: string;
  name: string;
  direction: PortDirection;
  /** World-space position. */
  pos: Vec;
  /** World-space outward normal. */
  facing: Vec;
  connected: boolean;
  connections: string[];
  nodeId: string;
}

export interface ResolvedAnchor {
  id: string;
  name: string;
  pos: Vec;
  nodeId: string;
}

export interface ResolvedNode {
  node: Node;
  def: ComponentDef | null;
  bounds: Rect;
  ports: ResolvedPort[];
  anchors: ResolvedAnchor[];
  error?: string;
}

export const DEFAULT_GRID: GridConfig = {
  size: 20,
  subdivisions: 4,
  origin: { x: 0, y: 0 },
  unit: 'px',
  visible: true,
  snap: true,
};

export const PAGE_PRESETS: Record<string, { w: number; h: number }> = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
  'ANSI A': { w: 216, h: 279 },
  'ANSI B': { w: 279, h: 432 },
  'ANSI C': { w: 432, h: 559 },
  'ANSI D': { w: 559, h: 864 },
  'ANSI E': { w: 864, h: 1118 },
  Letter: { w: 216, h: 279 },
  Tabloid: { w: 279, h: 432 },
};

export function makePage(preset: string, orientation: 'portrait' | 'landscape' = 'landscape'): PageConfig {
  const size = PAGE_PRESETS[preset] ?? PAGE_PRESETS.A4;
  const portrait = orientation === 'portrait';
  return {
    preset,
    width: portrait ? size.w : size.h,
    height: portrait ? size.h : size.w,
    orientation,
    margin: 10,
    frame: true,
    zones: true,
    scale: 4,
  };
}

export function emptyDocument(id = 'main', kind: SwDocument['kind'] = 'sheet'): SwDocument {
  return {
    id,
    name: kind === 'sheet' ? 'Main' : 'Component',
    kind,
    schemaVersion: 1,
    grid: { ...DEFAULT_GRID, origin: { ...DEFAULT_GRID.origin } },
    page: null,
    legend: null,
    meta: { title: 'Untitled', author: '', revision: 'A', sheetNumber: 1, sheetCount: 1 },
    nodes: {},
    connections: {},
    nodeOrder: [],
    connectionOrder: [],
  };
}
