/**
 * Plugins are the project-wide counterpart of a component script. A component script
 * decides how one part draws itself; a plugin acts on the whole drawing — aligning it,
 * exporting it, auditing it — and puts its actions in the toolbar.
 *
 * A plugin is a single `.js` file under `<library>/plugins/`, sandboxed exactly like a
 * component script, that calls `definePlugin({ ... })`.
 */

export interface PluginRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PluginPort {
  id: string;
  name: string;
  x: number;
  y: number;
  connected: boolean;
}

/** A node as a plugin sees it: a flat, already-resolved snapshot. */
export interface PluginNode {
  id: string;
  /** `libId/componentId` of the component this is an instance of. */
  ref: string;
  name: string;
  /** The stored transform — top-left of the instance box, and its rotation in degrees. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /**
   * The box to line things up against: painted geometry only, so a caption or an
   * invisible hit rectangle does not move an edge. This is the box the alignment guides
   * are drawn from, and what a plugin almost always wants.
   */
  bounds: PluginRect;
  /** Everything the node paints, including labels that overflow its geometry. */
  extent: PluginRect;
  params: Record<string, unknown>;
  ports: PluginPort[];
  selected: boolean;
  locked: boolean;
  /** Pinned to another node's anchor, so its position is not its own to set. */
  attached: boolean;
}

export interface PluginEndpoint {
  kind: 'port' | 'anchor' | 'free';
  nodeId?: string;
  portId?: string;
  x?: number;
  y?: number;
}

export interface PluginConnection {
  id: string;
  ref: string;
  from: PluginEndpoint;
  to: PluginEndpoint;
  selected: boolean;
}

export interface PluginGrid {
  size: number;
  subdivisions: number;
  originX: number;
  originY: number;
  unit: string;
  /** Whether snapping is currently switched on in the toolbar. */
  snap: boolean;
  /** The spacing actually drawn and snapped to: `size / subdivisions`. */
  step: number;
}

export interface PluginDoc {
  /** Document title, as shown in the title block. */
  title: string;
  /** A file-safe version of the title, ready to hang an extension off. */
  name: string;
  kind: string;
  /** Page size in millimetres, or null on an endless sheet. */
  page: { preset: string; width: number; height: number; orientation: string } | null;
}

/**
 * What a command is handed when it runs. `nodes`, `connections` and `selection` are a
 * snapshot taken before the command started: mutations do not rewrite them, so a command
 * can read its plan once and then apply it without the ground moving underneath.
 */
export interface PluginContext {
  mode: 'sheet' | 'component';
  doc: PluginDoc;
  grid: PluginGrid;
  nodes: PluginNode[];
  connections: PluginConnection[];
  /** Ids of the selected nodes and connections. */
  selection: string[];
  /** The selected nodes, in document order. */
  selected: () => PluginNode[];
  node: (id: string) => PluginNode | null;

  // -- mutation. Everything a command changes lands in one undo entry.
  move: (id: string, x: number, y: number) => void;
  moveBy: (id: string, dx: number, dy: number) => void;
  resize: (id: string, w: number, h: number) => void;
  rotate: (id: string, degrees: number) => void;
  setParam: (id: string, name: string, value: unknown) => void;
  remove: (id: string) => void;
  select: (ids: string[]) => void;

  // -- helpers
  /** Round a coordinate onto the grid lattice, whether or not snapping is on. */
  snapToGrid: (value: number) => number;

  // -- capabilities the app provides
  /** The drawing as SVG text. Defaults to the selection when something is selected. */
  svg: (options?: { selection?: boolean }) => string;
  /** Offer a text file for download. */
  download: (name: string, text: string, mime?: string) => void;
  /** Rasterise SVG text and offer it as a PNG. */
  downloadPng: (name: string, svg?: string, scale?: number) => Promise<void>;
  /** Open the print dialogue on the drawing, which is how a PDF is made. */
  print: (svg?: string, title?: string) => void;
  /** Tell the user something. */
  notify: (message: string, title?: string) => void;
}

/** A toolbar action. A command with `items` becomes a split button. */
export interface PluginCommand {
  id: string;
  label: string;
  hint?: string;
  /** Name from the icon set — see `PLUGIN_ICONS`. Unknown names fall back to a dot. */
  icon?: string;
  /** What clicking it does. A command with only `items` is a plain menu. */
  run?: (ctx: PluginContext) => unknown;
  /** Entries under the caret; the command itself stays the default action. */
  items?: PluginCommand[];
  /** Greyed out unless this returns true. */
  enabled?: (ctx: PluginContext) => boolean;
  /** Drawn as pressed when this returns true. */
  active?: (ctx: PluginContext) => boolean;
  /** Draw a rule above this entry in the menu. */
  separator?: boolean;
}

export interface PluginDefinition {
  id?: string;
  title?: string;
  description?: string;
  commands?: PluginCommand[];
}

/** The capabilities the app lends a plugin; everything that needs the DOM lives here. */
export interface PluginCapabilities {
  svg: (options?: { selection?: boolean }) => string;
  download: (name: string, text: string, mime?: string) => void;
  downloadPng: (name: string, svg: string, scale: number) => Promise<void>;
  print: (svg: string, title?: string) => void;
  notify: (message: string, title?: string) => void;
}
