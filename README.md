# swcad

A schematic-style diagram editor built from scratch — no tldraw, no excalidraw, no mxgraph.
It sits closer to a CAD tool than to a whiteboard: components are authored as **annotated SVG**,
they can carry **JavaScript** that participates in rendering, connectors terminate on **ports**
and reroute themselves, and a sheet can optionally be a fixed-size **blueprint page** with a
KiCad-style title block.

```
npm install
npm run dev          # http://localhost:5273
```

The dev server also mounts the local filesystem API at `/api`, so projects and libraries are read
and written straight from disk. `npm run preview` builds and serves the same thing from `dist/`
through a standalone Node server.

On boot the app opens `projects/demo`, creating it if needed. Open a different folder with
`?project=<absolute path>` — anything under `<app>/projects` or already-open project roots is
allowed; the server rejects traversal and symlink escapes. When you do not name one, the project
that was opened is written back into the URL, so the address always describes the whole screen.

### URLs

Every view is a link you can bookmark, reload, share and reach with the back button. The path says
what you are looking at; `?project=` is carried across every navigation untouched.

| Path | View |
|---|---|
| `/` | the sheet |
| `/component` | the component editor, on the component picker |
| `/component/<lib>/<id>` | that component, open for editing |
| `/component/<lib>/<id>/<file>` | ...with that package file in the code pane |

Opening another component adds a history entry; switching file tab rewrites the current one, so
**Back** leaves the component rather than walking its tabs. An unrecognised path, half a component
ref or a file the package does not have are rewritten to what is actually on screen.

## What is in the box

| Feature | Notes |
|---|---|
| Custom grid | Cell size, subdivisions, origin, units, visibility, snap toggle; drawn on a canvas layer with level-of-detail so it stays cheap at any zoom |
| Alignment highlighting | Every node contributes the edges and centre of its **painted** geometry, plus its port coordinates, to a global `AlignmentIndex`; while placing, dragging or connecting, matching rows/columns light up and snap. Nearby lines stay faint; every line the moving geometry actually lands on — edge to edge, centre to centre, port to port, several at once — is drawn bright. With **Snap to grid** on, a guide can only win if the resulting position is still on the grid lattice, so alignment can never drag a node off-grid |
| Optional page | ISO A0–A5, ANSI A–E, Letter, Tabloid or custom; orientation, margins, units-per-mm, blueprint frame with zone ticks and labels. Off by default (infinite canvas) |
| Legend / title block | A normal library component pinned bottom-right of the page, bound to document fields. Only available when a page is selected. The same component can also be dropped on the sheet, where each copy carries its own title/author/date/rev/size/sheet and falls back to the document metadata while a field is left blank |
| Component libraries | A library is a folder with `library.json` plus one folder per component (`components/<id>/`); it can export any number of components. A library marked `editorOnly` is offered in the component editor and not on sheets |
| Components are documents | A component's drawing is a `document.json` — byte-for-byte the format a sheet uses. It is drawn on the same canvas with the same tools, and compiled into flat annotated SVG when the library loads. A component may also be written directly as `shape.svg` + `annotations.json`; that is the primitive form `libs/meta` is made of |
| Annotated SVG components | Elements are tagged as `port`, `label`, `handle`, `fill_slot`, `anchor`, `hit_area`, `align` or `style`. The annotation is a property of the shape: a circle annotated as a port is connectable anywhere on its circumference. Fields may be written `{{params.x}}`, so one drawing means whatever the instance that placed it says |
| Component scripting | Sandboxed JS with `render`, `style` and `ports` hooks; scripts can read the whole graph and return SVG |
| Markdown text | The `meta/text` part is a block of Markdown — headings, bullets, ordered items, quotes, fences and inline `**bold**` / `*italic*` / `` `code` `` / `~~strike~~`. Double-click to edit the source in place. It has no parameters: its box is measured from the rendered text, so what you select is what you see |
| Connectors | Port-to-port with live preview, waypoints, straight/orthogonal/curve routers. The orthogonal router is an A* search that runs along the document's grid lines where it can (and an obstacle-derived lattice where it can't), so connectors staircase around obstacles instead of cutting through them. Endpoints follow the nodes they are attached to |
| Attachment | Any node can be pinned to another node's `anchor`; cycles are detected |
| Component editor | The sheet editor, pointed at a component's document. It opens on a picker — everything in the project on one side, the templates on the other — rather than inventing a blank component. Draw with the `meta` palette of primitives and annotation markers; the inspector shows the properties of whatever you picked, because what you picked is an ordinary node. The remaining package files (manifest, scripts) are edited as text beside the canvas |
| Export | SVG, PNG, and print-to-PDF; scripts are evaluated at export time and the legend is included |
| Dialogs | Questions are asked in the app's own modal — `window.alert`/`confirm`/`prompt` are not used anywhere. Destructive answers are red, Escape and the backdrop mean cancel, focus moves in and comes back, and a second question queues behind the first |

## Layout

```
src/core/       framework-agnostic engine (no React, no DOM assumptions)
  geometry/     vec/rect/transform math, path building, routers
  model/        document types, mutable store with undo/redo, GraphEngine
  spatial/      AlignmentIndex (row/column highlighting) + SpatialHash
  script/       SVG parse/build/sanitize, sandbox, dependency tracker
  theme/        the --sw-* canvas palette and its resolver
  library/      manifest parsing and the component registry
  io/           versioned (de)serialization + the fs API client
src/editor/     shared editor surface: controller, layers, panels, renderer, export
src/sheet/      sheet wiring: page frame + legend
src/component/  component editor: meta library, draft compiler
src/ui/         the widget library: buttons, number input, Monaco pane, dialogs, fields
src/ui/pomavo/  vendored subset of @pomavo/ui — shadcn/Radix primitives + theme registry
src/routes.ts   the URL <-> view mapping
server/         fs API with project-root sandboxing (Vite middleware + standalone)
libs/base/      the shipped base library
projects/       default location for projects created by the app
```

`src/editor/EditorSurface.tsx` is the crux of "the main editor and the component editor share the
same component": both mount the exact same surface, controller, tools and panels. The component
editor hands it the component's own `document.json` and mounts the extra `meta` library — a
component *is* a document, so there is nothing else to reconcile.

`libs/meta` is an ordinary library marked `editorOnly`. It offers the `rect` and `text` primitives
plus one marker per annotation kind. The shapes that are just as useful on a sheet — `line`, `arc`
and `ellipse` — live in `base` instead, so you can draw with them anywhere; `LibraryRegistry.MOVED`
keeps drawings that still name them `meta/…` working. An arc is inscribed in its box: `start`/`end`
are degrees with 0 = east turning clockwise, and `close` draws it as an open arc, a chord or a pie
slice.

`src/core/library/compile.ts` flattens a component's document into the SVG and annotation table a
placed instance renders: bounds from the non-marker nodes, ids namespaced per node, placement baked
into each element's own transform, inherited annotations re-exported and the rest resolved in
place. It runs once per component when a library loads, in dependency order.

`src/core/text/` measures and lays out text. Widths come from a canvas 2D context, not from an
average glyph width, so a label's box is the box the browser paints — that is what decides where
you can click. `markdown.ts` turns a Markdown source into explicitly positioned `<tspan>`s, which
is what a `label` annotation with `"markdown": true` draws; nothing depends on how SVG collapses
whitespace, and the measured block is exactly the block that appears.

A node's `rotation` turns it about the middle of its box, so a rotated shape keeps its position
instead of swinging around its top-left corner. The pivot is resolved by the graph (never stored in
the document) and is honoured by ports, anchors, bounds, export and the compiler.

## Placing

Picking a component from the palette arms it; the next click on the sheet drops it. While it is
armed the editor draws a **ghost** — the component itself, faint, at the position it would land,
snapped exactly as the drop will be. Nothing else on the canvas says what is armed or where it
would go, so without it a click is a guess about both. It is the real drawing rather than an
outline box because the two differ: a component may hang off its origin instead of filling its
instance box, and a script may draw something no box describes.

The ghost costs a repaint only when it would actually move, so with snapping on it repaints once
per grid cell rather than once per pixel. Connectors arm the same way but draw no ghost — they are
made by dragging between ports, not by a click, so there is no landing position to preview.

`Escape` puts the tool away; holding `Shift` while dropping keeps it armed for the next one.

### Equal gaps

Alignment guides answer "is this edge level with that one". They say nothing about *rhythm*,
which is what actually makes a row look deliberate: the gaps between things being the same
number. So while a node is being placed or dragged, the editor also looks at the gap it is about
to make with its nearest neighbour, and if that gap matches one already on the sheet it pulls the
node onto it and draws both gaps as CAD-style **dimension brackets** — `|<--- 97 --->|` for the
gap being made, and the same bracket, half as bright, over the gap it is copying. Landing exactly
halfway between two neighbours is the same rule with no third component involved: both gaps are
the node's own, so both are drawn at full strength.

A gap is only compared against things sharing a band with it — a horizontal gap needs the two
items to overlap vertically — so a bracket always belongs to a row or a column instead of
measuring across the whole sheet. At most one pair is drawn per axis; the point is to show a
match, not to dimension the drawing. Alignment guides are full-height lines and would otherwise
run along a dimension line or strike through its number, so they give way: the guides are cut
back around each bracket, leaving it in clear space.

Against the other snaps, an equal gap beats the grid but loses to alignment: being level with
something is a stronger statement than being evenly spaced from it, and if both are available at
the same distance the guide wins. With snap-to-grid on the pulled position must itself land on
the lattice, the same rule alignment obeys, so the grid is never quietly broken — on a
grid-snapped sheet the gaps are multiples of the grid anyway, so matches are still reachable.
Brackets are computed from the position the node has actually landed on rather than from the
cursor, so a bracket is a statement of fact, not a suggestion.

### What lines up

Guides come from the **ink**, not from the bounding box: a component publishes the extent of the
geometry it actually paints, plus its port positions. Text, transparent hit areas and hidden
elements are left out, because you line a drawing up by what you can see.

The difference shows on a captioned icon. Its box runs from the top of the icon to the bottom of
the subtitle, so the box centre sits somewhere in the caption — a coordinate that is halfway down
nothing, offered alongside the icon's own middle. Ink-based guides give the three lines you would
draw by hand: the top, the middle and the bottom of the icon, with the caption along for the ride.
The dragged node probes with the same box it publishes, so what lights up is symmetric.

A component can overrule the rule with an [`align` annotation](docs/authoring-components.md):
`{ "kind": "align", "snap": false }` on a painted decoration keeps it out of the guides, and
`"snap": true` on invisible geometry puts it in.

A guide runs the full height of the sheet because it is a claim about a coordinate, not about a
stretch of empty space — but it has nothing to say where something is already drawn. So the
components are punched out of it, outline and all, and each guide reads as the run of clear space
between the things it lines up. Connectors are punched out along the line they draw rather than by
their box — an orthogonal route claims the whole detour it makes, most of which is empty sheet —
together with their captions, which a line through the middle of spoils worst. The component being
placed is punched out too: its ghost is as much a drawing as the rest.

## Selecting

Selection follows the drawing, never the box around it.

- **A click picks what is painted under the pointer.** The browser has already hit-tested the SVG
  the editor drew — through every rotation, scale, fill rule and stacking decision — so the editor
  asks it rather than re-deriving an answer from bounds. Clicking the hollow middle of a diamond or
  a ring therefore goes *through* to whatever is behind it, and clicking a shape means that shape,
  which is what the Inspector then shows. A shape too thin to aim at is what the `hit_area`
  annotation is for; a few pixels of slack around the pointer cover ordinary hairlines and glyphs.
- **A marquee takes only what it swallows whole.** An item joins the selection when its entire
  bounding box lies inside the rect, so a sweep that merely brushes past a neighbour leaves it
  alone. Drag the box *around* what you mean.

Hold `Shift` to add to the selection either way.

The Inspector appears only while something is selected, and it **floats over the drawing** rather
than holding a column of its own. Selecting is the most ordinary thing you can do on a canvas, and
it must not resize the canvas underneath the pointer: a pane that came and went would re-frame the
drawing mid-gesture and move whatever you were about to click on next.

A selected connector also reports the **length of the route as drawn**, under its two endpoints.
It is the one property of a connector nothing else can tell you: the path is chosen by the router,
so the only way to see what a change to the layout cost is to read it off.

### Editing several items at once

With more than one item selected the Inspector stops describing any single part and shows the
ground the selection has in common:

- **Only shared properties appear.** A property is shared when every selected item declares one of
  the same name and type — and, for a dropdown, the same options. Select six shapes and `Stroke`
  stays; select a line among them and `Fill` disappears, because a line has none. Position, size and
  rotation are offered only while every item is a node, since a connector has no box of its own.
- **A field shows a value only when the selection agrees on it.** Where the items differ the field
  is blank and reads *Mixed*; a checkbox shows a dash.
- **Typing writes to everything selected.** A blank, mixed field is the way to make a selection
  agree: give it a value and all of them take it. Each item keeps its own defaults, so clearing a
  field returns each to whatever *it* declared rather than to a neighbour's value. The whole write is
  one edit — a single undo puts every item back.

### Paint order

The Inspector's header carries the four ordering buttons — send to back, back one, forward one,
bring to front. A step moves the selection past exactly one neighbour that is *not* also selected,
so a group travels together and keeps its own internal order instead of collapsing into a pile. The
pairs grey out at the ends of the stack, which is how the panel tells you something is already at
the front without you having to click to find out. Connectors have no ordering: they are painted as
their own layer beneath every component, so there is no stack for them to move through.

## Annotating a primitive

An annotation is a **property of the shape**, not a marker you place beside it. Every drawable
primitive in the `meta` library carries a `Port name` parameter: fill it in and the shape's own
element becomes a port. Leave it blank and the annotation is dropped. The same pattern gives every
primitive a `Style slot` name, which is how a script drives a drawn component.

A port annotation has a `surface`:

| Surface | Meaning |
|---|---|
| `point` (default) | The connector terminates at the element's anchor point — the classic pin/marker port |
| `outline` | The element's **whole drawn edge** is connectable |

Annotating a primitive writes `surface: "outline"`, so a circle annotated as a port accepts a
connector anywhere on its circumference and a rectangle accepts one anywhere along its stroke. The
end point is not fixed: it is the crossing of the shape's edge with the line towards the other
endpoint (or the nearest waypoint), together with the outward normal there — so it slides round the
edge as the other end moves, and the router still leaves along a sensible direction.

Where an avoiding route may meet such a port is a separate question, answered by the grid rather
than by aiming: a connector on a snapped sheet only travels along lanes, so the spots it can leave
from are exactly the places the shape **crosses a grid line**, and those are solved for directly —
a crossing of a column is left vertically, of a row horizontally. The router prices every spot
against the whole connector and takes the shortest, which is why a big ring offers more places to
land than a small one and why two mirrored nodes get mirrored connectors. With snapping off there
are no lines to cross, so the shape is sampled by direction instead.

`base/box` and `base/circle` keep their four compass ports *and* expose their body outline as an
`edge` port. Hit-testing prefers a compass port wherever the two coincide, and an outline port is
only grabbed with the **Connect** tool so dragging near a node's border in select mode still moves
the node. An outline that spans its own shape — a line or an arc annotated as a port along its
whole length — counts as body-sized whatever its size, so the select tool can still pick it up.

## Project layout on disk

```
<project>/
  project.swcad.json        title, author, grid/page/legend defaults, sheet list
  sheets/main.sheet.json    a graph document
  .swcad/history/           one undo journal per sheet, written by auto-save
  libs/<libname>/
    library.json
    components/<id>/        one folder per component
      component.json        manifest: id, name, version, params
      document.json         the drawing, as a document — same format as a sheet
      script.js             optional behaviour
      README.md             optional notes
    shared/<name>.js        importable from scripts via ctx.require('lib:name')
```

A component drawn as raw markup replaces `document.json` with `shape.svg` (its viewBox sets the
default size) and `annotations.json` (element id -> port / label / handle / slot / anchor / hit
area / style). That is the primitive form; `libs/meta` is written that way, and so is anything
whose art comes out of a drawing program.

Beside `params`, a manifest may set `resizable: false` (no Width/Height in the inspector) and
`pivot: {x, y}` — the local point a rotation turns about. Rotation otherwise turns about the
middle of the instance box, which is the middle of the *drawing* only for a component that
fills that box; a script that hugs its content or hangs its artwork off the node's origin is
otherwise carried around a point outside itself, and a quarter turn reads as an orbit.

Every one of these files gets a tab in the component editor, `document.json` included — asking
where a component keeps its geometry and finding no answer in the file list is worse than a tab
you cannot type into. That one is **read-only** and always live: it shows the drawing as the
canvas has it this instant, not as it was last written, because while a component is open the
document store owns the drawing and re-serialises it on every change. Anything typed there would
be discarded by the next nudge of a shape, so the drawing is edited on the canvas and read here.

Libraries are discovered in `<app>/libs` (read-only, shipped) and `<project>/libs` (writable).
The server watches both and hot-reloads the registry when files change.

## Saving

The sheet saves itself. An edit is written once the burst it belongs to settles (~0.7 s), and a
continuous gesture is checkpointed at least every 4 s; a save is held back until the pointer
comes up so a half-finished drag never reaches disk, and leaving the tab flushes whatever is
outstanding. Writes never overlap, and a failed one keeps the work queued and retries. The
toolbar badge reads **Saved**, **Unsaved**, **Saving…** or **Save failed** — hover it for the
error. `Ctrl+S` is still there; it just skips the wait.

The undo journal is saved with the sheet, into `.swcad/history/<sheet>.history.json`, so `Ctrl+Z`
still walks back through your work after a reload. It stores the last 200 transactions per stack
(oldest dropped first, capped at 1 MB) and is stamped with a fingerprint of the sheet it was
recorded against: edit the sheet JSON by hand and the journal is discarded rather than replayed
against a document it no longer describes. Deleting `.swcad/` only costs undo depth.

The component editor is separate — component packages are still saved explicitly, so a half-typed
script is never hot-reloaded into the sheet.

## Base library

`box`, `circle`, `diamond`, `text`, `arrow` and `title-block`. `box` demonstrates state-driven
styling ("turn green when every port is connected"), `text` is a markdown block that is typed
straight onto the drawing and resizes itself to fit, and `arrow` is a fully scripted, graph-aware
connector that inspects nearby obstacles and picks its own path.

## Software library

Twenty architecture pictograms (service, database, queue, CDN, …) drawn by one shared script,
`libs/software/shared/chassis.js`: an icon with a title and subtitle under it, an invisible rect
hugging that content as the hit area, and a transparent circle around the icon as the port.

These are the one shipped family that is **not resizable**. The drawing hugs its content, so the
instance box was never its size — dragging it only fed the icon size, and fed it badly: the glyph
got whatever room the caption left, so two boxes dragged to the same size came out with different
icons whenever their labels were different lengths. `Icon size` says the number instead, and the
box follows it. The instance box is not consulted at all; a value below 8, or none, is read as
unset and comes out at the default 40, so sheets drawn before the parameter existed still look
like the palette.

The symbol also hangs from its **port ring**, not from a corner: the node's origin is the centre
of the circle a connector lands on. A corner origin put the port at `origin + boxW / 2`, and half
a hugged box is whatever the caption made it — so a symbol dropped exactly on the grid still had
an off-grid port. That matters because a snapped route may only travel along the lattice, and the
lattice is only symmetric about a line that lies on it: two symbols placed as mirror images routed
to visibly different lengths, their ports sitting at the *same* offset from a grid line instead of
opposite ones. Hanging from the ring makes the port inherit the node's own snap, and makes equally
spaced symbols have equally spaced ports whatever their captions say.

Rotation turns about that same point, declared as `pivot: {x: 0, y: 0}` in each manifest: the
port holds still and stays on the grid it was snapped to, and the symbol turns in place rather
than orbiting the middle of an instance box it does not fill.

## UML library

Thirty-six UML 2.0 parts in `libs/uml`, covering the notation you actually draw: class,
interface, enumeration, data type, object, component, artifact, deployment node and package for
structure; actor, use case, action, object node, state, decision, fork, initial/final/flow-final
node, history, send/receive signal, lifeline, partition, boundary, frame and combined fragment for
behaviour; and association, directed association, aggregation, composition, generalization,
realization, dependency and message as connectors. A note rounds it off.

Five shared modules do all the drawing, so the notation is decided once rather than thirty-six
times:

| Module | What it owns |
|---|---|
| `shared/theme.js` | Fonts, padding, leading, text measurement, line and stack layout |
| `shared/classifier.js` | The compartment box: name over separators over member lists |
| `shared/container.js` | Package, frame, partition, boundary and note |
| `shared/shapes.js` | Actor, use case, action, control nodes, signals, lifeline |
| `shared/relation.js` | One connector chassis: arrowheads, dashes, roles, multiplicities |

**Member lists are one per line.** A class's attributes and operations are plain text
parameters, edited in a text area in the inspector; blank lines are dropped, and a compartment
that is empty stays as a thin empty strip because "this class has no attributes" is a statement,
not an omission. This is what the new `multiline: true` flag on a `ParamDef` is for — the
inspector renders a growing `<textarea>` instead of a one-line field.

**A classifier box is as big as its instance box or as big as its contents, whichever is
bigger.** Drag it larger and it stays larger; type past the bottom and it grows. Neither clipping
the member list nor ignoring the size you dragged to would be defensible.

**Containers draw their border as four separate strokes, not one rectangle, and declare no hit
area.** A `hit_area` annotation makes the whole node a single solid obstacle, which is right for
an opaque card and wrong for a package: a connector must be able to run *through* the region it
is drawn inside. Four thin bars register as four thin obstacles and the interior stays open. The
four edges all carry a port named `edge`, so they behave as one logical port that a connector
attaches to on whichever side is nearest.

**Connectors are one component with a different pair of ends.** `relation.render` takes a head
kind for each end (`none`, `open`, `filled`, `triangle`, `diamond`, `filled-diamond`, `cross`,
`ball`, `socket`), a dash pattern, an optional stereotype and name, and per-end role names and
multiplicities. The stroke is trimmed back by the head's depth so a hollow triangle is not drawn
over its own line.

## Theming

The chrome is built on a vendored subset of **`@pomavo/ui`** in `src/ui/pomavo/` — shadcn-style
Radix primitives (button, input, select, checkbox, tabs, dialog, dropdown, tooltip, …), a `cn()`
helper, Tailwind v4 as the utility layer, and Pomavo's theme registry. Only the two host-agnostic
theme files were copied; nothing from Pomavo's product code came with them.

- **Default theme:** Ayu Dark. The toolbar's theme button switches appearance (light / dark /
  system) and palette (Ayu Mirage, Ayu Dark, and five accent themes). Both persist to
  `localStorage` under `swcad.theme`.
- **How it reaches the app:** `ThemeProviderBase` writes 33 `--color-*` custom properties onto
  `<html>` and toggles `light`/`dark` plus `data-color-theme`. `src/ui/theme.css` maps swcad's own
  tokens (`--bg`, `--line`, `--text`, `--accent`, …) and the `--sw-*` canvas palette onto those, so
  the whole editor — chrome *and* drawing — re-themes from one switch.
- **Style:** *borderless* — separation comes from background steps (`--hover`, `--sunken`) and
  spacing rather than outlines. Chrome appears on hover; borders survive only where they carry
  meaning (the page sheet, the focus ring, the active tab underline).
- **Gotcha:** `theme.css` is unlayered, so any rule in it outranks *every* Tailwind utility
  (Tailwind v4 emits into `@layer utilities`). Classes that are also passed to a Pomavo component
  — `.btn`, `.input`, `.check` — are therefore kept to layout only. Do not put `background`,
  `border` or `color` on them.

### The canvas palette

The drawing follows the theme too, through a set of `--sw-*` custom properties declared on top of
the `--color-*` ones: `--sw-paper`, `--sw-surface`, `--sw-ink`, `--sw-ink-muted`, `--sw-line`,
`--sw-accent`, `--sw-accent-2`, `--sw-success`, `--sw-warning`, `--sw-danger`, `--sw-port` and
`--sw-1`…`--sw-5`. The grid, the page frame, the guides and the selection overlay all read from
them, and so may any component:

```svg
<rect id="body" fill="var(--sw-surface)" stroke="var(--sw-ink)" />
```

Browsers resolve `var()` inside SVG presentation attributes, so on screen this costs nothing — the
attribute passes through the sanitiser untouched and the engine paints it. A component that writes
a literal colour instead keeps that colour forever; nothing rewrites authored hex. The shipped
`base` and `meta` libraries use tokens throughout.

Two places need real colour strings and get them from `readCanvasPalette()`, which resolves each
token through a probe element (`getPropertyValue` would hand back an unresolved `color-mix(...)`):

- `GridLayer` / `HighlightLayer`, which paint into a 2D canvas;
- **export** — a standalone SVG carries no stylesheet, so `exportSvg` substitutes every
  `var(--sw-*)` with its current value and paints a matching background. An export looks like the
  screen it came from, dark theme included.

## Rendering model

`GraphEngine.resolve()` runs a five-stage pipeline per document revision:

1. static geometry (parse + scale the authored SVG)
2. effective transforms (attachment chains, cycle-safe)
3. port and connection maps
4. node resolution — annotations, then the `render` / `style` / `ports` script hooks
5. connections — endpoint resolution, obstacle gathering, script or default routing

Script reads are recorded as dependency keys (`node:<id>`, `conn:<id>`, `ports:<id>`,
`bucket:<x>,<y>`, `clock:minute`), so a graph-aware component is only recomputed when something
actually changes inside the region it inspected — not on every frame.

### Palette tiles

A tile runs the component's own `render` hook (`src/core/library/preview.ts`) rather than showing
its authored `shape.svg`, because a scripted component ships no geometry and used to come out
blank. The context it is given is deliberately barren — one node at the origin with its default
parameters, an empty graph, a stopped clock — so a component that colours itself by how many of
its ports are connected draws its unconnected self instead of failing. A connector is handed one
straight run left to right, which is the pose that shows an arrowhead and a dash pattern most
plainly.

The tile is framed on the drawing's *measured* bounds, not on `defaultSize`: a script is not
obliged to fill its instance box or even to start at the origin. Results are cached against the
entry object, which the registry replaces whenever a library loads or a component is saved.

## Connector routing

Picking a connector from the palette arms it and switches to the connect tool, the same way
picking a node arms the place tool — the next drag between two ports draws *that* connector, and
it stays armed until the tool changes, because connecting is a mode and one association is rarely
the only one. The toolbar's own connect button clears the arming, so it always means the plain
`base/arrow`.

A connector is drawn by one of three routers, picked from the toolbar's **Routing** group or
from `Routing` in the inspector:

| Router | What it draws |
| --- | --- |
| **Orthogonal** | right angles, searched around every obstacle in the way. The default |
| **Straight** | a direct line from port to port, obstacles ignored |
| **Curved** | a smooth curve that leaves each port along its normal |

The toolbar group re-routes whatever connectors are selected and remembers the choice for the
next connector you draw, so it works as a tool setting as much as a property; with a mixed
selection no member of the group is lit. The style is stored per connection, so two connectors
between the same pair of ports can route differently.

The rest of this section is about the orthogonal router, which is the one that has to think.

An orthogonal connector leaves each port along its normal, and the segment between the two
stub ends is found with **A\*** over a sparse routing lattice: one line just outside each side
of every nearby obstacle, plus the lines through the ports and a mid lane. Moves cost their
length plus a **bend penalty** per corner (`Bend cost` on the arrow, default 0), so routes
come out short, straight and stable, and a connector will staircase around any arrangement of
nodes rather than pick the least-bad of a few fixed elbow shapes. A route never retraces its
own exit stub, and never arrives at a port from behind it. Raise the bend cost to buy fewer
corners at the price of a longer path.

Obstacles are one box per **drawn primitive**, not one box per node. A component is mostly
empty space between its strokes — a maze, three stacked rails, a body between two arc caps —
and treating it as a single box meant a connector could neither route through it nor leave one
of its strokes without crossing all the others. So a route threads the gaps a component
actually has, and the stub only has to clear the stroke carrying its own port.

Declare a **`hit_area`** to say otherwise: a component with one is handed to the router as a
single solid box, whatever it happens to be drawn from. That is the right answer for anything
whose inside is meant to read as filled even when it is drawn hollow.

**Captions block on their own account.** A route has to be let through whatever rect its port
sits inside, or it could never arrive — and for a component whose port is drawn within its own
outline that is the entire node, which is how an arrow ended up landing across the very name it
was pointing at. Each label is therefore handed over as a rect in its own right, with a few
pixels of padding: the port is not inside it, so it goes on blocking while the node around it
stands aside. That padding is all a caption gets — the clearance below is not added on top of
it, since a line passing a word needs a hair of white space, not the room a solid shape asks
for. Stacking the two let a caption repel a route it was nowhere near: a connector once bent
four times to clear a label by five hundredths of a unit.

A caption that says nothing occupies nothing. An empty string still has a line height, and a
sliver of pure height was enough to stretch the node's bounds — the rect a route treats as
solid — well past the drawing, in a direction fixed by wherever the caption would have sat.
Two mirrored symbols were both stretched the *same* way rather than opposite ways, so their
routes came out different lengths. A label with no width is now no obstacle, and a label whose
component drew no element for it at all is dropped rather than left where the shipped artwork
happened to put it.

**A caption on a vertical run reads along the line.** It is cut out of its own connector either
way, so a horizontal word across a vertical run removed a few units of line and blocked eighty
units of everything else: its box lay across the lanes to both sides, and a neighbouring
connector that wanted one of them had to stagger around a word it never touched. Turned
anticlockwise, the caption covers its own lane and the length of line it hides matches what a
horizontal caption has always hidden on a horizontal run.

Which nodes count as "nearby" is not a fixed radius. The search starts from a band around the
straight line between the two ports, and then **grows to include whatever it finds**: every
obstacle inside the band widens the region to that obstacle's full extent, and the region is
queried again until nothing new turns up. A route that has to detour leaves the band it started
in, and anything out there the router had not been told about it would happily drive straight
through — so an obstacle you must get around brings its own neighbourhood with it.

None of this is capped. There is no ceiling on primitives per component, obstacles per search,
grid lines per axis or lattice nodes, because every such ceiling was a silent wrong answer: the
search would decline, the old candidate-shape engine would take over, and the connector would
cut through a wall rather than admit it had given up. Lane coordinates are deduplicated and
blocking is marked per obstacle over the cells it covers, so a figure of hundreds of thin
strokes on a regular pitch — a maze, a title block — costs far less than its count suggests.
A 40 x 20 maze is 364 separate obstacles and routes in about a second.

Routes keep a **clearance** from every obstacle, which is what stops a connector running flush
against the thing it is avoiding. Clearance is resolved per obstacle rather than for the route
as a whole: a node barely narrower than the corridor it sits in cannot have the full clearance
on both its own bounds and the wall beside it, so those two split the gap between them, and
every obstacle clear of both endpoints keeps the full amount. Without that, one pinched
endpoint would drag the entire route down to its own clearance and the connector would hug
walls from end to end.

Clearance is then tried in a ladder (full, half, quarter, none) so tightly packed nodes still
get a legal path, and the old candidate-shape search remains as a fallback for endpoints that
are genuinely walled in. Set the arrow's `Router` param to `simple` to force that engine.

Clearance says only "not through here", so of two routes of the same length the search used to
return whichever it happened to reach first — including one that traced a node's corner two
units outside its clearance while the other ran through open space. Travel alongside an
obstacle therefore costs a **hair more than its length**, within a band as wide as the
clearance again. It is far too small to bend a route that has somewhere to be, so it decides
only between routes that were otherwise a wash, and among those it takes the one with air
around it. It has to stay that small for a second reason: the search's estimate knows nothing
about crowding, so a larger charge is slack in the heuristic, and twenty times this value
doubled the cost of dragging a node without changing a single route.

The search never sees the stub segments — they run from the port to the first lattice node, and
from a surface port that segment is a diagonal — and it lets an endpoint escape whatever it
starts inside. So the finished path is re-checked against the raw obstacles before it is
accepted, exempting only what an endpoint is genuinely inside. A path that fails drops to the
next rung of the ladder.

The curved router's only shape control is how far the curve runs before it turns, and it takes
that from the distance between the ports rather than from the orthogonal router's clearance
stub: on a long run a lead-in of a few units against a span of hundreds makes the smoothing
overshoot into a hook at the port.

An `outline` port meets the connector wherever the geometry says, which on a long straight edge
is an arbitrary fractional coordinate. While **Snap to grid** is on, that meeting point then
slides *along its own edge* to the nearest grid line, provided one lies within three quarters of
a step — so a connector leaving a line or a box edge starts on the lattice like every other run.
The point never leaves the stroke it was dragged from and its facing normal is unchanged, and
curves are left alone: an ellipse has no straight run, and an arc's flattened segments are far
shorter than a grid step. The drag preview, the port marker and the resolved connection all ask
the same function, so the preview cannot disagree with the result.

Ports of one component that share a **name** are one logical port with several pins. A connector
bound to any of them attaches to whichever pin is easiest to reach — nearest attach point, plus a
penalty worth the node's width or height for a pin whose facing normal points away from the other
end — and it hops between them as either end moves, without the stored connection changing. Ties
go to the stored pin so nothing twitches mid-drag. The group also shares its connection list, so
every pin reads as connected once one of them is wired, and two pins of the same group cannot be
joined to each other.

## Keyboard

| Key | Action |
|---|---|
| `V` / `H` / `C` | select / pan / connect tool |
| Space (hold) | temporary pan |
| Wheel | zoom in/out — the first notch centres the point under the cursor, then the session zooms about the centre (KiCad-style) |
| Horizontal scroll / `Shift` + wheel | pan horizontally |
| `Ctrl` + wheel / trackpad pinch | zoom anchored at the cursor, without recentring |
| `F` / `Shift+1` | zoom to fit the drawing in the viewport |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+A` / `Ctrl+D` | select all / duplicate |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | copy / cut / paste. A paste lands under the cursor (snapped) and cascades if you paste again without moving; connections come along when both of their endpoints are copied, and it works between the sheet and component editors |
| `Delete` | delete selection |
| Arrows | nudge (with `Shift` for a larger step) |
| `Esc` | cancel the current gesture |
| `Ctrl+S` | save the sheet now (it auto-saves anyway) |
| Double-click | edit a `label` annotation in place. A Markdown label opens a multi-line editor: `Ctrl`/`Cmd`+`Enter` commits, `Esc` cancels |

The toolbar is icon-only (Radix icons); every button carries an `aria-label` and a tooltip that
spells out the action and its shortcut. It drives whichever canvas is in front, so the tools,
undo/redo, zoom, snap/port toggles and the exporters all work the same way in the component
editor — where **Fit** frames the component at the same magnification opening it does, and where
**Save** and `Ctrl+S` save the component rather than the sheet behind it.

## Scripts

```
npm run dev        Vite dev server + fs API
npm run build      tsc --noEmit && vite build
npm run preview    standalone Node server over dist/
```

## Docs

- [Authoring components](docs/authoring-components.md) — the component package format and every annotation kind
- [Scripting API](docs/scripting-api.md) — the sandbox and the full `ctx` surface

## Known limits

- The script sandbox is isolation by capability removal, not a security boundary: an infinite loop
  still freezes the tab. The module boundary is kept clean so a Worker or QuickJS-wasm backend can
  be swapped in without touching component code.
- Node scripts run in one pass per frame, so script-to-script cross-references settle on the next
  frame rather than immediately.
- Multi-user collaboration, remote library registries, hierarchical sheets and ERC/netlist checking
  are out of scope, but the model leaves room for all four.
