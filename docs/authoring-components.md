# Authoring components

A component is a **folder** — the same way a plugin is a folder in most apps. Drop it into a
library and it is picked up; delete it and it is gone. Nothing has to be registered anywhere.

```
libs/<libId>/
  library.json
  components/<compId>/
    component.json      manifest: id, name, version, params, default size
    document.json       the drawing, as a document — the same format a sheet uses
    script.js           optional behaviour, run in the sandbox
    README.md           optional notes
  shared/<name>.js      optional, importable from any script in the library
```

Only `component.json` is required. The other files are picked up **by name**; the manifest may
point somewhere else (`"document": "drawing.json"`) but nothing has to be declared.

**A component is a document.** `document.json` is byte-for-byte the same format as a sheet: nodes
placed at transforms, connections between them, a grid. Designing a component is therefore the
same act as drawing a sheet, in the same editor, with the same tools — you place parts, select
one, and edit *its* properties in the inspector. When the library loads, the document is
**compiled** into flat SVG plus a table of annotations, which is what a placed instance renders.

Drawing has to bottom out somewhere, so a component may instead be written as raw markup:

```
    shape.svg           the drawing; a standalone, viewable SVG
    annotations.json    element id -> what that element means
```

That is the **primitive** form. It is what `libs/meta` is made of and what the compiler emits, and
it is still the right choice for a component whose art comes out of Inkscape. A package has one
form or the other: if `document.json` is present it wins.

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
  "marker": false,                // true = this part marks a place, not a picture (see below)
  "params": [ /* ParamDef[] */ ],
  "defaultSize": { "w": 160, "h": 90 },  // optional: defaults to the shape's viewBox
  "resizable": true,

  // All optional overrides — omit them and the conventional file names are used.
  "document": "document.json",
  "shape": "shape.svg",
  "annotations": "annotations.json",     // or an inline object
  "script": "script.js"
}
```

`library.json` may also carry `"editorOnly": true`, which keeps the library out of the sheet
palette. `libs/meta` uses it: its parts are what components are made of, not things to put on a
sheet.

## `document.json`

A serialised document — `nodes`, `connections`, `grid` — exactly as `sheets/*.sheet.json` is. Every
node references another component. The plain shapes live in `base` (`base/line`, `base/arc`,
`base/ellipse`) alongside the ordinary parts, since a line on a sheet is as reasonable as a line
inside a component; `libs/meta` keeps `meta/rect`, `meta/text` and the markers that only mean
something inside a component (`meta/label`, `meta/port`, `meta/anchor`, `meta/handle`,
`meta/hit-area`). Any component may be used, so components compose.

```jsonc
{
  "schemaVersion": 1, "id": "box", "name": "Box", "kind": "component-draft",
  "grid": { "size": 10, "subdivisions": 2, "origin": { "x": 0, "y": 0 }, "unit": "px", "visible": true, "snap": true },
  "nodes": [
    { "id": "body", "componentRef": "meta/rect",
      "transform": { "x": 0, "y": 0, "rot": 0, "scale": 1 }, "size": { "w": 160, "h": 90 },
      "params": { "fill": "#ffffff", "stroke": "#2e3440", "radius": 4, "port": "edge", "slot": "body" }, "z": 0 },
    { "id": "p-e", "componentRef": "meta/port",
      "transform": { "x": 148, "y": 33, "rot": 0, "scale": 1 }, "size": { "w": 24, "h": 24 },
      "params": { "name": "east", "direction": "inout" }, "z": 1 }
  ],
  "connections": []
}
```

### What compilation does

1. **Bounds.** The union of every non-hidden, non-marker node. The drawing is translated so that
   corner is the origin, and its size becomes the component's `defaultSize`.
2. **Ids** are namespaced `<nodeId>-<elementId>`, so two copies of the same part keep their own
   ports.
3. **Placement is baked** into each top-level element's own `transform` — never a wrapping `<g>`,
   because hit-testing and port geometry read an element's own transform but not its ancestors'.
4. **Meaning travels, decoration does not.** An annotation is re-exported if `isInherited` says so:
   ports, anchors, handles, hit areas and slots yes; `style` and plain `label` no. A non-inherited
   label has its resolved text written into the drawing; an inherited one keeps its binding, so the
   *placed* component's parameter drives it.
5. **Markers are stripped** to the one element their annotation is attached to (see below).
6. **Connections are baked** verbatim: they were already routed, so they are part of the picture.

A cycle (a component that draws itself, however indirectly) compiles to an empty drawing and a
recorded problem rather than hanging.

### `marker`

A port pin, an anchor cross and a resize grip mark a *place*, not a picture. Drawn in full while
you are placing them — otherwise you could not see them — but `"marker": true` says two things to
the compiler: the part does not contribute to the parent's bounds (a port on an edge must not push
the box outwards), and everything it draws is discarded except the element its annotation sits on.

That element is a zero-sized shape at the marker's own centre, and the marker's `viewBox` is
square and centred on it, so rotating the marker aims it without moving the point it marks.

### Driving a drawn component from a script

A node's `style` annotation binds to *that node's* parameters, so it cannot see the outer
component's. To forward one, name a **style slot**: every drawable meta part takes a `slot`
parameter, and a non-empty value exports a `fill_slot` of that name from the compiled component.
`libs/base/components/box` sets `slot: "body"` on its rectangle, and `script.js` paints it:

```js
defineComponent({
  style(ctx) {
    return { slots: { body: { fill: ctx.params.fill, stroke: ctx.params.stroke } } };
  },
});
```

## `shape.svg`

The primitive form, and what compilation emits. A complete, standalone SVG file — open it in a
browser, edit it in Inkscape or Illustrator, diff it in a review. Its `viewBox` declares the
component's default size, and everything inside the root `<svg>` becomes the component geometry:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
  <rect id="body" x="0" y="0" width="160" height="90" rx="4"
        fill="var(--sw-surface)" stroke="var(--sw-ink)" />
  <text id="title" x="80" y="50" text-anchor="middle">Box</text>
  <circle id="p-e" cx="160" cy="45" r="3.5" />
</svg>
```

Every element you want to annotate, style or bind needs a stable `id`. The markup is parsed and
sanitised (tag/attribute allowlist — no `<script>`, no `on*` handlers, no external `href`) and
rendered inside a `<g>` carrying the node transform.

### Colours: fixed or borrowed

A colour written as a literal — `#2e3440`, `rebeccapurple`, `rgb(0 0 0)` — is **fixed**. It is
stored as you wrote it, drawn as you wrote it, and no theme change ever touches it. Use one when
the colour *is* the component: a sticky note is yellow, a warning triangle is red.

A colour written as `var(--sw-*)` is **borrowed** from the active theme, so the component follows
whichever palette the drawing is being viewed in:

| Token | What it is |
| --- | --- |
| `--sw-paper` | the drawing surface itself |
| `--sw-surface` / `--sw-surface-2` | body fills — a card sitting on the paper, and a second one |
| `--sw-ink` | default stroke and text |
| `--sw-ink-muted` | secondary text, captions |
| `--sw-line` | hairlines, frames, table rules |
| `--sw-accent` / `--sw-accent-2` | the theme's primary colour and a cooler companion |
| `--sw-success` / `--sw-warning` / `--sw-danger` | state colours |
| `--sw-port` | port glyphs and connection endpoints |
| `--sw-1` … `--sw-5` | categorical series colours |

They work anywhere a colour does — a presentation attribute in `shape.svg`, a `style` annotation,
a `color` parameter's default, or a string returned from a script:

```svg
<rect id="body" fill="var(--sw-surface)" stroke="var(--sw-ink)" stroke-width="1.5" />
<text id="cap" fill="var(--sw-ink-muted)" font-size="7">DRAWN BY</text>
```

```js
// In a script — a box that goes green once every port is wired up.
style: function (ctx) {
  var wired = ctx.ports.every(function (p) { return p.links.length > 0; });
  return { slots: { body: { stroke: wired ? 'var(--sw-success)' : 'var(--sw-ink)' } } };
}
```

Add a fallback when the component might be rendered somewhere with no stylesheet:
`fill="var(--sw-ink, #2e3440)"`.

In the inspector, a `color` parameter shows a swatch that opens the palette; pick a theme chip to
borrow, or use the fixed picker below it. The text box next to the swatch shows the short token
name (`ink`) and accepts one, so typing `accent` stores `var(--sw-accent)`.

**On export** there is no stylesheet to resolve against, so the exporter substitutes every
`var(--sw-*)` with the colour it currently resolves to and paints the background to match. An
exported SVG, PNG or PDF therefore looks like the screen it was exported from — switch to a light
theme first if you want a light drawing.

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
{ "name": "fill",  "type": "color",   "default": "var(--sw-surface)" }
{ "name": "dashed","type": "boolean", "default": false }
{ "name": "style", "type": "enum",    "default": "orthogonal", "options": ["straight", "orthogonal", "curve"] }
```

Parameters appear in the inspector automatically and are readable from scripts as `ctx.params`.
Add `"hidden": true` to keep one out of the inspector — for a value that is edited on the drawing
itself, the way `meta/text` stores the Markdown you type into it.

The inspector shows `X`, `Y` and `Rotation` for every component, and `Width`/`Height` only when the
component is `resizable`.

Rotation turns about the middle of the instance box — except on an axis the drawing has no
thickness on, where it turns about the drawing itself. `base/line` runs along the top edge of a
box that has to be at least a unit tall to exist at all; pivoting on the box centre would put the
line half a unit off the lattice the moment it was stood on end. If you author a part that draws a
bare line, keep its geometry on the box edge and this falls out for free.

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
`annotations.json` then has no tab of its own and the table is edited in the manifest.

Two things make an annotation more than a plain record, and both are what let a single drawing
like `meta/port` mean whatever the instance that placed it says it means.

**One element may carry several.** Give it an array — a rectangle can be painted from a parameter
*and* be connectable at once:

```json
{ "body": [
    { "kind": "style", "attrs": { "fill": "params.fill", "stroke": "params.stroke" } },
    { "kind": "port", "name": "{{params.port}}", "direction": "inout", "surface": "outline" }
] }
```

**Fields may be written as `{{params.x}}`.** They are filled in from the instance's parameters. A
field that is nothing but a placeholder keeps the value's own type (`min` stays a number, `facing`
stays a pair); inside a longer string it interpolates. A blank value switches the annotation *off*
— a port with no name, an anchor with no name, a slot with no name and a label bound to nothing are
dropped rather than half-applied. That is how one part is optionally a port.

**`inherit`** decides whether an annotation survives when its component is flattened into another.
The default is "meaning yes, decoration no": ports, anchors, handles, hit areas and slots are
inherited; `style` and `label` are not. Set it explicitly to override — `meta/label` is a label
with `"inherit": true`, which is exactly what makes it a label of the component you are drawing
rather than a fixed piece of text.

### `style`

Sets attributes on the element from the instance's parameters. The values are *paths*, not
placeholders — `"params.fill"`, not `"{{params.fill}}"` — and an unset one leaves the authored
attribute alone.

```json
{ "kind": "style", "attrs": { "fill": "params.fill", "stroke-width": "params.strokeWidth", "rx": "params.radius" } }
```

This is how the meta primitives are parameterised, and it is not inherited: a compiled component
carries the resolved attributes, not the binding.

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

The exit direction on an open stroke follows its curvature: a curved stroke has a genuine outer
side — the one its own centroid is not on — and the connector leaves that way, which is the only
exit that clears the shape the stroke belongs to. It matters at a tip, where a connector coming
from across the component (a node above a cylinder aiming at its bottom cap) would otherwise be
faced straight back through the body and have to cut across it. A straight stroke has no such
side, so it keeps facing whichever side the connector arrives from.

Outlines are read straight from the element (`rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `path`), including its own `transform`, and follow the node's position, size and
rotation. In the component editor, pick the element in the **Elements** panel, set its kind to
`port` and choose **Surface: outline**.

**The rest of the component gets out of the way.** A connector attached to one primitive treats
that primitive as the thing it is allowed to touch, and every *other* drawn shape of the same
component as an obstacle. A rail port on the middle of three stacked lines is therefore left in
the gap between them and the route goes round the end of the line below, instead of the whole
component being one solid box the connector may cut across on its way out. Nothing is needed in
the annotations for this; it follows from the drawing. Components neither end is attached to are
still treated as a single box, so a connector merely passing by never threads between their
strokes.

**Same name, one port.** Give several elements of a component the *same* `name` and they stop
being separate ports: they become one logical port with several pins. A connector bound to any of
them is drawn from whichever pin suits its other end, and it hops between them as either end
moves — no rewiring, and the stored connection never changes.

```json
{
  "pin-w": { "kind": "port", "name": "gnd", "facing": [-1, 0] },
  "pin-e": { "kind": "port", "name": "gnd", "facing": [1, 0] },
  "pin-n": { "kind": "port", "name": "gnd", "facing": [0, -1] },
  "pin-s": { "kind": "port", "name": "gnd", "facing": [0, 1] }
}
```

The choice is the pin whose attach point is nearest the other end, plus a penalty for pins whose
`facing` points the wrong way — worth the width (or height) of the node, since that is the detour
a backwards-facing pin costs. So the near side wins, and a pin on the far side of the body never
wins by a whisker of straight-line distance. Ties go to the pin the connection is stored on, so
nothing twitches while you drag. Mixed point and outline pins are fine; an outline pin is measured
at the point the connector would actually reach, not at its centre.

The group is one port everywhere else, too: every pin reports the group's connections (so
`connected` is true on all four above as soon as one is wired, and a script asking "are all my
ports connected" gets a sane answer), `ctx.graph.connectionsOf(node, pin)` answers for the group,
and two pins of the same group cannot be joined to each other. Ports you want kept apart simply
need distinct names — the default name is the element id, so this never happens by accident.

Name a group `edge` when its pins are simply "anywhere on this symbol" and nothing distinguishes
them. That is what `base/box` and `base/circle` call their outline port and what every component
in `libs/software` calls its four pins, so a connector can be dropped on any of them and land the
same way. Reserve real names for pins that mean different things — `base/diamond` keeps `yes` and
`no` apart precisely because picking the near one would be wrong.

**Compact vs body-sized outlines.** An outline port that covers at most a quarter of the node's
area (and no more than 60% of either axis) counts as *compact*: a small pin, pad or tab. Compact
ports behave like discrete ones — the pointer picks them up in the select tool, they show their
marker on hover and a connector can be dragged straight out of them. A body-sized outline (the
`edge` port on `base/box`, say) is only live while the connect tool is armed, so dragging the
node's own border still moves the node instead of starting a connector.

An outline that *spans* its node — a line, an arc, or any shape annotated as a port along its own
whole length — is body-sized however small it is. A line has no thickness, so measuring it by area
would make every straight stroke a compact pin and leave the shape itself impossible to click; the
span test settles it instead, and the connect tool is still how you wire one up.

**Visibility differs by editor.** On a sheet these markers are quiet: a port is drawn only while
the connect tool is armed, the **Ports** toggle is on, or the pointer is over that node. In the
component editor a port, anchor or handle is a part you have placed, so it is drawn in full all
the time — that is what a marker is for.

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

Setting `"markdown": true` renders the bound value as Markdown instead of one run of text:

```json
{ "kind": "label", "bind": "params.text", "editable": true, "markdown": true }
```

This is what `meta/text` is — a `<text>` element carrying nothing but a markdown label. The
element's own `x`/`y` become the **top-left of the block** rather than a baseline, its children are
replaced by positioned `<tspan>`s, and the node's box is the measured box of the rendered result,
so selecting and hovering match what you see. Double-clicking opens a multi-line editor holding the
Markdown source; `Ctrl`/`Cmd`+`Enter` commits it and `Esc` cancels.

Supported: `#`…`######` headings, `-`/`*`/`+` bullets, `1.` ordered items, `>` quotes, ``` fences,
and inline `**bold**`, `*italic*`, `` `code` `` and `~~strike~~`, with `\` to escape a marker.
There is no wrapping — a line breaks where you break it.

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

It has a second effect: a component with a hit area is handed to the connector router as a
**single solid box**. Without one, the router is given a box per drawn primitive and will
happily thread a connector between the strokes of a component that is mostly empty space.
Declare a hit area when the inside of your component should read as filled even though it is
drawn hollow.

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

The shipped `base/box` is the same component written the other way: a `document.json` holding a
`meta/rect` with `port: "edge"` and `slot: "body"`, a `meta/label` bound to `params.title`, four
`meta/port`s and a `meta/handle`, plus the same `script.js`. Compiling it produces the markup
above. Open it in the component editor to see it.

## Connector components

Set `"connector": true`. Connectors are not placed with a transform — they are created between two
endpoints and their script receives `ctx.connection` (`from`/`to` positions and facings, plus
`waypoints`) and `ctx.obstacles` instead of `ctx.node`. See
`libs/base/components/arrow/script.js`.

A connector script hands its computed polyline back to the editor by putting the JSON point array
in a `data-swcad-route` attribute on any element it returns. The editor uses it for hit-testing
and waypoint editing; without it the engine falls back to its own router.

## Using the component editor

The **Component editor** tab is the sheet editor, pointed at a component's `document.json`. Same
canvas, same tools, same grid, same snapping, same inspector — because a component is a document.

- **It opens on a picker.** The editor does not invent a component for you: it opens a dialog with
  every component in the project on the left and the templates on the right. Click one to edit it,
  or fill in an id, pick a library and **Create** to scaffold a new one. Three templates ship with
  the app: *Shape with ports* (a rounded box with four compass ports and a bound label), *Blank*
  (one rectangle) and *Connector* (a scripted arrow, no drawing). The bin on a component deletes it
  from disk. Dismissing the dialog leaves the editor empty; the **component button in the topbar**
  brings it back.
- **You draw on the canvas.** Opening a component frames it — centred and zoomed to fill the pane
  (up to 200%, so a small part is not blown up). The **Meta** palette holds the parts a component
  is *made of* — a rectangle, an ellipse, an arc, a line, text, and one part per annotation kind.
  Pick one and click to place it. It is an ordinary node: select it, drag it, rotate it, resize it,
  copy it, undo it. Any other component in the project may be placed too, so components compose.
- **The Inspector shows what you picked.** Select the rectangle and you get the rectangle's fill,
  stroke, corner radius and port name; select a port and you get its name, direction and colour.
  With nothing picked the pane is not there at all, and the canvas takes its width.
- The **file tabs** below hold the rest of the package — the manifest, scripts, the README.
  `document.json` is deliberately *not* among them: it is edited on the canvas. `+` adds a file,
  the bin removes one.
- **The file pane minimises.** The chevron at the right-hand end of the tab strip collapses the
  pane to just its tabs and gives the height back to the drawing; clicking any tab brings it back
  on that file. The state is remembered between sessions, and while the pane is shut a red count
  appears next to the chevron if the component has errors or warnings — click it to read them.
  Collapsing or reopening keeps whatever was in the middle of the canvas in the middle of it.
- The editor is **Monaco** (the editor behind VS Code), bundled with the app rather than fetched
  from a CDN, so it works offline. Files open in the language their extension implies, and JSON
  syntax errors are underlined as you type, alongside the package problems listed under the pane.
  Each file keeps its own cursor and undo history while you switch tabs. Its palette is built at
  runtime from the app's own CSS variables, so the pane follows whatever you pick in the theme menu;
  syntax colours come from the theme's chart colours and are lightened or darkened as needed to stay
  legible against that theme's background.
- **Connector components** have no drawing to place, so they keep a preview bench: two boxes joined
  by the connector, so the script has something to route between.
- **Opening and saving are in the topbar**, in the same places a sheet has them, because there is
  nothing about a component that needs its own set. The button beside the mode switch names what is
  open — `test-lib/db`, *New component*, *Copy of base/box* — and clicking it opens the picker. The
  **Save** button at the right saves the *component*, shows its state, and answers to `Ctrl+S`.
  Once a component has been saved once, further edits **autosave**, and Save just skips the wait.
  A component that has nowhere to go yet — a fresh scaffold whose library has gone away, or a copy
  of a read-only one — asks which library to write to first, and can make a new one from there.
  Saving under a new id writes a new package and offers to delete the old one. The sidebar is only
  the parts palette; it disappears entirely when nothing is open.
- **Double-click a component in the sheet palette to open it**, or use the pencil that appears on
  hover — a single click arms it for placing. The bin deletes a component after telling you how
  many instances are on the sheet. The component editor's own palette is for drawing only: browsing
  and creating live in the picker.
- **What is open is in the address bar.** Editing a component puts it there as
  `/component/<lib>/<id>`, and the file in the code pane follows as a last segment — so a component
  is a link you can bookmark or paste to someone with the same project. **Back** steps out to
  whatever you were editing before rather than through the file tabs, and stepping out of the last
  one lands on the picker.

The shipped `libs/base` is mounted read-only (the server refuses writes to it too), so opening one
of its components gives you a copy — Save then asks which writable library to put it in, and can
create one on the spot.

Legacy single-file `components/<id>.comp.json` components still load; saving converts them to a
folder.

### The meta library

`libs/meta` is a normal library marked `"editorOnly": true`, so it appears in the component
editor's palette and not on a sheet. Its components are normal components — folders with a
`component.json`, a `shape.svg` and an `annotations.json`. Nothing about them is special-cased.

| Part | What it is |
|---|---|
| Rectangle, Ellipse, Arc, Line | A shape whose fill, stroke, dash and radius are parameters. Name its `port` parameter and its whole edge becomes connectable |
| Text | A block of Markdown, baked into the drawing. Double-click to edit it; it has no parameters, and its box is measured from the rendered text |
| Label | Text that follows a parameter of the component you are drawing, and stays editable once placed |
| Port | A pin a connector can terminate on. Rotate it to aim it outwards |
| Anchor | A point other components can be pinned to |
| Resize handle | A grip that drives the placed component's size |
| Hit area | Invisible geometry that is selectable but not drawn |

Every drawable part **except Text** also takes a **Style slot** parameter, which is how a script
drives a drawn component — see above.

The last four are **markers**: they draw a visible pin, cross or grip while you place them, and
compile down to a single point. They do not grow the component, so a port on an edge leaves the
edge where it is.

Adding a part means adding a folder. There is no registry to update.
