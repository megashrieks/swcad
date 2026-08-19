import type { Rect, Transform, Vec } from '../geometry/index';

export type AnnotationKind = 'port' | 'label' | 'handle' | 'fill_slot' | 'anchor' | 'hit_area';

export type PortDirection = 'in' | 'out' | 'inout' | 'none';

export interface PortAnnotation {
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

export interface LabelAnnotation {
  kind: 'label';
  name?: string;
  /** Dotted path into the render context, e.g. `params.title` or `node.id`. */
  bind: string;
  align?: 'start' | 'center' | 'end';
  editable?: boolean;
}

export interface HandleAnnotation {
  kind: 'handle';
  name?: string;
  /** Params driven by dragging this handle, in [x, y] order. */
  drives: string[];
  axis?: 'x' | 'y' | 'both' | 'radial';
  min?: number;
  max?: number;
}

export interface FillSlotAnnotation {
  kind: 'fill_slot';
  name: string;
}

export interface AnchorAnnotation {
  kind: 'anchor';
  name: string;
}

export interface HitAreaAnnotation {
  kind: 'hit_area';
  name?: string;
}

export type Annotation =
  | PortAnnotation
  | LabelAnnotation
  | HandleAnnotation
  | FillSlotAnnotation
  | AnchorAnnotation
  | HitAreaAnnotation;

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
  annotations: Record<string, Annotation>;
  /** Relative path to the script inside the library, e.g. `scripts/box.js`. */
  script?: string;
  defaultSize?: { w: number; h: number };
  resizable?: boolean;
}

export interface LibraryManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Optional palette ordering hint; components are discovered by scanning. */
  components?: string[];
  shared?: string[];
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
