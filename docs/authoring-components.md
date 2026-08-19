# Authoring components

A component is a **folder** — the same way a plugin is a folder in most apps. Drop it into a
library and it is picked up; delete it and it is gone. Nothing has to be registered anywhere.

```
libs/<libId>/
  library.json
  components/<compId>/
    component.json      manifest: id, name, version, params, default size
    shape.svg           the drawing; a standalone, viewable SVG
    annotations.json    element id -> what that element means
    script.js           optional behaviour, run in the sandbox
    README.md           optional notes
  shared/<name>.js      optional, importable from any script in the library
```

Only `component.json` is required. The other files are picked up **by name**; the manifest may
point somewhere else (`"shape": "art.svg"`) but nothing has to be declared.

`library.json`:

```json
{
  "id": "base",
  "name": "Base",
  "version": "1.0.0",
  "description": "Shipped primitives.",
  "components": ["components/box", "components/arrow"]
}
```

`components` is only an **ordering hint** for the palette — components are discovered by scanning
the folder, so adding or removing one needs no bookkeeping. Missing entries are appended
alphabetically.

Components are referenced from documents as `libId/compId` (an optional `@version` suffix is
accepted and currently ignored during resolution).

## `component.json`

```jsonc
{
  "id": "box",
  "name": "Box",
  "version": "1.0.0",
  "category": "shapes",           // groups the component in the palette; "sheet" marks legend templates
  "description": "…",
  "connector": false,             // true = driven by two endpoints (arrows) instead of a transform
  "params": [ /* ParamDef[] */ ],
  "defaultSize": { "w": 160, "h": 90 },  // optional: defaults to the shape's viewBox
  "resizable": true,

  // All optional overrides — omit them and the conventional file names are used.
  "shape": "shape.svg",
  "annotations": "annotations.json",     // or an inline object
  "script": "script.js"
}
```

## `shape.svg`

A complete, standalone SVG file — open it in a browser, edit it in Inkscape or Illustrator, diff it
in a review. Its `viewBox` declares the component's default size, and everything inside the root
`<svg>` becomes the component geometry:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
  <rect id="body" x="0" y="0" width="160" height="90" rx="4" fill="#fff" stroke="#2e3440" />
  <text id="title" x="80" y="50" text-anchor="middle">Box</text>
  <circle id="p-e" cx="160" cy="45" r="3.5" />
</svg>
```

Every element you want to annotate, style or bind needs a stable `id`. The markup is parsed and
sanitised (tag/attribute allowlist — no `<script>`, no `on*` handlers, no external `href`) and
rendered inside a `<g>` carrying the node transform.

The authored geometry is the component at its default size. When an instance is resized the
engine **recomputes the geometry** rather than applying an SVG `scale()` transform: coordinates and
dimensions (`x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`,
`points` and path `d` data) are multiplied by `size.w / defaultSize.w` and `size.h / defaultSize.h`,
port positions included.

Presentation attributes are deliberately **not** scaled — `stroke-width`, `font-size`,
`stroke-dasharray` and letter spacing stay in absolute world units. A resized component therefore
keeps a crisp constant-width border and unstretched text instead of looking like a stretched bitmap.
`r` on a `<circle>` cannot scale anisotropically, so it uses `min(sx, sy)`; use `<ellipse>` with
`rx`/`ry` if you want a circle that stretches.

If a scripted `render()` hook returns geometry, that geometry is **not** rescaled — the script is
expected to draw at `ctx.node.size` directly. Read `ctx.node.size` and lay out your shape yourself
when you need full control over how a component resizes (for example, keeping a corner radius
constant while the box grows). A component may have no `shape.svg` at all if its script draws
everything.

### Parameters

```jsonc
{ "name": "title", "type": "string",  "label": "Title", "default": "Box" }
{ "name": "radius", "type": "number", "default": 4, "min": 0, "max": 40, "step": 1 }
{ "name": "fill",  "type": "color",   "default": "#ffffff" }
{ "name": "dashed","type": "boolean", "default": false }
{ "name": "style", "type": "enum",    "default": "orthogonal", "options": ["straight", "orthogonal", "curve"] }
```

Parameters appear in the inspector automatically and are readable from scripts as `ctx.params`.

## Annotations

`annotations.json` maps an SVG element id to what that element *means*. It is the source of truth;
the compiler mirrors it onto the rendered DOM as `data-swcad-*` attributes.

```json
{
  "body": { "kind": "fill_slot", "name": "body" },
  "title": { "kind": "label", "bind": "params.title", "align": "center", "editable": true },
  "p-e": { "kind": "port", "name": "east", "direction": "inout", "facing": [1, 0] }
}
```

Small components may inline the same object into `component.json` under `"annotations"` instead;
the editor then shows the annotation panel read-only and points you at the manifest.

### `port`

Connector termination point.

```json
{ "kind": "port", "name": "east", "direction": "inout", "facing": [1, 0], "accepts": ["base/arrow"], "max": 4 }
```

- `direction` — `in` | `out` | `inout` | `none`
- `facing` — outward normal in local space; the router uses it to choose the exit direction
- `surface` — `point` (default) or `outline`
- `accepts` — optional allowlist of connector refs
- `max` — optional maximum number of connections

**Point vs outline.** A `point` port sits at the element's centroid (or a path endpoint) — the
familiar pin. An `outline` port turns the element's whole drawn edge into the connectable surface:

```json
{ "kind": "port", "name": "edge", "direction": "inout", "surface": "outline" }
```

Annotate a `circle` this way and a connector may land anywhere on its circumference; annotate a
`rect` and its stroke becomes the port. The end point is not stored — on every resolve it is the
crossing of the edge with the line towards the other endpoint (or the nearest waypoint), so it
slides round the shape as the other end moves. `facing` is derived from the outward normal at that
crossing, so a fixed `facing` is only worth setting to force a particular exit direction.

**Closed vs open shapes.** A closed shape (a rect, circle, polygon, or a path ending in `Z`)
surrounds its own centre, so the crossing above is well defined. An open stroke — a `line`,
`polyline`, or an arc such as `M 1 30 A 50 25 0 0 1 101 30` — does not, and a half-arc curves away
from its bounding-box centre entirely. Such a stroke is met at the point on it *nearest* the
incoming end instead, clamped to its tips: a rail port catches the connector level with wherever it
comes from, and a cap arc catches it on the curve rather than in the hollow. Rotating the element
(or the node) makes no difference — the stroke is transformed first, then measured.

Outlines are read straight from the element (`rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `path`), including its own `transform`, and follow the node's position, size and
rotation. In the component editor, pick the element in the **Elements** panel, set its kind to
`port` and choose **Surface: outline**.

**Compact vs body-sized outlines.** An outline port that covers at most a quarter of the node's
area (and no more than 60% of either axis) counts as *compact*: a small pin, pad or tab. Compact
ports behave like discrete ones — the pointer picks them up in the select tool, they show their
marker on hover and a connector can be dragged straight out of them. A body-sized outline (the
`edge` port on `base/box`, say) is only live while the connect tool is armed, so dragging the
node's own border still moves the node instead of starting a connector.

**Visibility differs by editor.** On a sheet these markers are quiet: a port is drawn only while
the connect tool is armed, the **Ports** toggle is on, or the pointer is over that node. The
component editor's preview bench does the opposite and always reveals every port, outline and
anchor the draft declares, since that overlay *is* the read-out of your annotation table — if a
shape you annotated is not lit up, the annotation is not attached to the element you think it is.

### `label`

Text slot bound to a value, editable in place on double-click.

```json
{ "kind": "label", "bind": "params.title", "align": "center", "editable": true }
```

`bind` is a dotted path into the render scope: `params.*`, `node.*`, or `meta.*` (document
metadata).

Several paths may be listed with `|`, and the first one that has a value wins:

```json
{ "kind": "label", "bind": "params.title|meta.title", "align": "start", "editable": true }
```

That is how the title block gives every instance its own fields while still falling back to the
document: a blank block shows `meta.title`, and as soon as you type into it the text is stored in
that node's `title` param. An in-place edit always writes to the **first** path, so editing one
component never rewrites another.

Double-clicking picks the editable label nearest the pointer, so a component with several fields
(the title block has seven) opens the one you actually clicked.

### `handle`

Draggable point that drives one or more values.

```json
{ "kind": "handle", "drives": ["size.w", "size.h"], "axis": "both", "min": 40 }
```

- `drives` — targets in `[x, y]` order; `size.w`/`size.h` or `params.<name>`
- `axis` — `x` | `y` | `both` | `radial`
- `min` / `max` — clamps

### `fill_slot`

Named region a script can restyle. `style()` returns `{ slots: { <name>: { fill, stroke, … } } }`
and those attributes are merged onto the annotated element.

```json
{ "kind": "fill_slot", "name": "body" }
```

### `anchor`

Attach point for *non-connector* children. Another node can be pinned to it with
`{ parentId, anchorId, offset }`; when the parent moves, the child follows. Attachment chains are
resolved topologically and cycles are detected.

```json
{ "kind": "anchor", "name": "top" }
```

### `hit_area`

Invisible geometry used only for selection and hover. Useful when the visible shape is thin.

```json
{ "kind": "hit_area", "name": "hit" }
```

## Worked example

`libs/base/components/box/` in full:

**`component.json`**

```jsonc
{
  "id": "box",
  "name": "Box",
  "version": "1.0.0",
  "category": "shapes",
  "resizable": true,
  "params": [
    { "name": "title", "type": "string", "default": "Box" },
    { "name": "fill", "type": "color", "default": "#ffffff" },
    { "name": "stroke", "type": "color", "default": "#2e3440" }
  ]
}
```

**`shape.svg`** — the `viewBox` is the default size, so no `defaultSize` is needed:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
  <rect id="body" x="0" y="0" width="160" height="90" rx="4" fill="#fff" stroke="#2e3440" />
  <rect id="edge" x="0" y="0" width="160" height="90" rx="4" fill="none" stroke="transparent" />
  <text id="title" x="80" y="50" text-anchor="middle">Box</text>
  <circle id="p-e" cx="160" cy="45" r="3.5" />
  <rect id="a-top" x="78" y="-2" width="4" height="4" fill="none" />
  <rect id="h-se" x="156" y="86" width="8" height="8" fill="none" />
</svg>
```

**`annotations.json`**

```json
{
  "body": { "kind": "fill_slot", "name": "body" },
  "edge": { "kind": "port", "name": "edge", "direction": "inout", "surface": "outline" },
  "title": { "kind": "label", "bind": "params.title", "align": "center", "editable": true },
  "p-e": { "kind": "port", "name": "east", "direction": "inout", "facing": [1, 0] },
  "a-top": { "kind": "anchor", "name": "top" },
  "h-se": { "kind": "handle", "drives": ["size.w", "size.h"], "axis": "both", "min": 40 }
}
```

**`script.js`** — optional; see [scripting-api.md](./scripting-api.md).

## Connector components

Set `"connector": true`. Connectors are not placed with a transform — they are created between two
endpoints and their script receives `ctx.connection` (`from`/`to` positions and facings, plus
`waypoints`) and `ctx.obstacles` instead of `ctx.node`. See
`libs/base/components/arrow/script.js`.

A connector script hands its computed polyline back to the editor by putting the JSON point array
in a `data-swcad-route` attribute on any element it returns. The editor uses it for hit-testing
and waypoint editing; without it the engine falls back to its own router.

## Using the component editor

The **Component editor** tab edits the package files directly — what you see is what is on disk,
never a decompiled approximation.

- **New** scaffolds a package from a template in `templates/components/`. Three ship with the app:
  *Shape with ports* (a rounded box with four compass ports, a label and a script), *Blank* (one
  rectangle) and *Connector* (a scripted arrow, no shape).
- The **preview bench** at the top renders the component through the real engine: a normal
  component gets one instance, a connector gets two boxes joined by it. It follows the size the
  shape declares until you resize the instance yourself.
- The **file tabs** below hold every file in the package. Edit them as text; the preview updates as
  you type. `+` adds a file (a second script, a README, an asset), the bin removes one.
- The editor is **Monaco** (the editor behind VS Code), bundled with the app rather than fetched
  from a CDN, so it works offline. Files open in the language their extension implies — `xml` for
  `shape.svg`, `json` for the manifest and annotations, `javascript` for scripts — and JSON syntax
  errors are underlined as you type, alongside the package problems listed under the pane. Each
  file keeps its own cursor and undo history while you switch tabs; opening another component
  starts fresh.
- The **Elements** panel on the right lists every id in `shape.svg` and writes `annotations.json`
  for you — pick a kind and fill in the fields. Ids in `annotations.json` with no matching element
  are shown with a *no element* warning.
- **Save into** picks the target library, then **Save** writes the whole folder and hot-reloads the
  registry. Saving under a new id writes a new package and offers to delete the old one.
- Clicking a component in the palette opens it. The pencil does the same from the sheet editor's
  palette; the bin deletes a component after telling you how many instances are on the sheet.

The shipped `libs/base` is mounted read-only (the server refuses writes to it too), so opening one
of its components gives you a copy — pick a writable library and save. **New library** creates one
inside the project.

Legacy single-file `components/<id>.comp.json` components still load, and opening one in the editor
shows it as package files with its SVG carried across verbatim; saving converts it to a folder.
