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
allowed; the server rejects traversal and symlink escapes.

## What is in the box

| Feature | Notes |
|---|---|
| Custom grid | Cell size, subdivisions, origin, units, visibility, snap toggle; drawn on a canvas layer with level-of-detail so it stays cheap at any zoom |
| Alignment highlighting | Every node contributes its bbox edges, centre and port coordinates to a global `AlignmentIndex`; while placing, dragging or connecting, matching rows/columns light up and snap. With **Snap to grid** on, a guide can only win if the resulting position is still on the grid lattice, so alignment can never drag a node off-grid |
| Optional page | ISO A0–A5, ANSI A–E, Letter, Tabloid or custom; orientation, margins, units-per-mm, blueprint frame with zone ticks and labels. Off by default (infinite canvas) |
| Legend / title block | A normal library component pinned bottom-right of the page, bound to document fields. Only available when a page is selected. The same component can also be dropped on the sheet, where each copy carries its own title/author/date/rev/size/sheet and falls back to the document metadata while a field is left blank |
| Component libraries | A library is a folder with `library.json` plus one folder per component (`components/<id>/component.json`, `shape.svg`, `annotations.json`, `script.js`); it can export any number of components |
| Annotated SVG components | Elements are tagged as `port`, `label`, `handle`, `fill_slot`, `anchor` or `hit_area`. The annotation is a property of the shape: a circle annotated as a port is connectable anywhere on its circumference |
| Component scripting | Sandboxed JS with `render`, `style` and `ports` hooks; scripts can read the whole graph and return SVG |
| Connectors | Port-to-port with live preview, waypoints, straight/orthogonal/curve routers. The orthogonal router is an A* search that runs along the document's grid lines where it can (and an obstacle-derived lattice where it can't), so connectors staircase around obstacles instead of cutting through them. Endpoints follow the nodes they are attached to |
| Attachment | Any node can be pinned to another node's `anchor`; cycles are detected |
| Component editor | The same editor surface plus a `meta` library of primitives and annotation markers, a parameter-schema editor, a script editor and a live preview |
| Export | SVG, PNG, and print-to-PDF; scripts are evaluated at export time and the legend is included |

## Layout

```
src/core/       framework-agnostic engine (no React, no DOM assumptions)
  geometry/     vec/rect/transform math, path building, routers
  model/        document types, mutable store with undo/redo, GraphEngine
  spatial/      AlignmentIndex (row/column highlighting) + SpatialHash
  script/       SVG parse/build/sanitize, sandbox, dependency tracker
  library/      manifest parsing and the component registry
  io/           versioned (de)serialization + the fs API client
src/editor/     shared editor surface: controller, layers, panels, renderer, export
src/sheet/      sheet wiring: page frame + legend
src/component/  component editor: meta library, draft compiler
server/         fs API with project-root sandboxing (Vite middleware + standalone)
libs/base/      the shipped base library
projects/       default location for projects created by the app
```

`src/editor/EditorSurface.tsx` is the crux of "the main editor and the component editor share the
same component": both mount the exact same surface, controller, tools and panels — the component
editor simply hands it a draft document and mounts the extra `meta` library.

The `meta` library offers the `rect`, `ellipse`, `arc`, `line` and `text` primitives plus one marker
per annotation kind. An arc is inscribed in its box: `start`/`end` are degrees with 0 = east turning
clockwise, and `close` draws it as an open arc, a chord or a pie slice.

A node's `rotation` turns it about the middle of its box, so a rotated shape keeps its position
instead of swinging around its top-left corner. The pivot is resolved by the graph (never stored in
the document), is honoured by ports, anchors, bounds and export, and the component editor compiles
it into the component's own SVG so the live preview matches the canvas.

## Annotating a primitive

An annotation is a **property of the shape**, not a marker you place beside it. Every primitive in
the `meta` library carries an `Annotate as` parameter: a rectangle, ellipse, arc or line can become a
`port`, an `anchor` or a `hit area`, and a text primitive can become a `label`. Nothing extra is
emitted — the shape's own element gets the annotation.

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

`base/box` and `base/circle` keep their four compass ports *and* expose their body outline as an
`edge` port. Hit-testing prefers a compass port wherever the two coincide, and an outline port is
only grabbed with the **Connect** tool so dragging near a node's border in select mode still moves
the node.

## Project layout on disk

```
<project>/
  project.swcad.json        title, author, grid/page/legend defaults, sheet list
  sheets/main.sheet.json    a graph document
  libs/<libname>/
    library.json
    components/<id>/        one folder per component
      component.json        manifest: id, name, version, params
      shape.svg             the drawing; its viewBox sets the default size
      annotations.json      element id -> port / label / handle / slot / anchor / hit area
      script.js             optional behaviour
    shared/<name>.js        importable from scripts via ctx.require('lib:name')
```

Libraries are discovered in `<app>/libs` (read-only, shipped) and `<project>/libs` (writable).
The server watches both and hot-reloads the registry when files change.

## Base library

`box`, `circle`, `diamond`, `note`, `arrow` and `title-block`. `box` demonstrates state-driven
styling ("turn green when every port is connected") and `arrow` is a fully scripted, graph-aware
connector that inspects nearby obstacles and picks its own path.

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

## Connector routing

An orthogonal connector leaves each port along its normal, and the segment between the two
stub ends is found with **A\*** over a sparse routing lattice: one line just outside each side
of every nearby obstacle, plus the lines through the ports and a mid lane. Moves cost their
length plus a **bend penalty** per corner (`Bend cost` on the arrow, default 25), so routes
come out short, straight and stable, and a connector will staircase around any arrangement of
nodes rather than pick the least-bad of a few fixed elbow shapes. A route never retraces its
own exit stub, and never arrives at a port from behind it.

Clearance is tried in a ladder (full, half, quarter, none) so tightly packed nodes still get a
legal path, and the old candidate-shape search remains as a fallback for lattices too large to
search or endpoints that are genuinely walled in. Set the arrow's `Router` param to `simple`
to force that engine.

## Keyboard

| Key | Action |
|---|---|
| `V` / `H` / `C` | select / pan / connect tool |
| Space (hold) | temporary pan |
| Wheel | zoom in/out — the first notch centres the point under the cursor, then the session zooms about the centre (KiCad-style) |
| Horizontal scroll / `Shift` + wheel | pan horizontally |
| `Ctrl` + wheel / trackpad pinch | zoom anchored at the cursor, without recentring |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+A` / `Ctrl+D` | select all / duplicate |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | copy / cut / paste. A paste lands under the cursor (snapped) and cascades if you paste again without moving; connections come along when both of their endpoints are copied, and it works between the sheet and component editors |
| `Delete` | delete selection |
| Arrows | nudge (with `Shift` for a larger step) |
| `Esc` | cancel the current gesture |
| `Ctrl+S` | save the sheet |
| Double-click | edit a `label` annotation in place |

The toolbar is icon-only (Radix icons); every button carries an `aria-label` and a tooltip that
spells out the action and its shortcut.

## Scripts

```
npm run dev        Vite dev server + fs API
npm run build      tsc --noEmit && vite build
npm run preview    standalone Node server over dist/
npm test           Vitest unit tests
npm run test:e2e   headless browser smoke flow (needs `npm run dev` running)
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
