# Plugins

A component script decides how one part draws itself. A **plugin** acts on the whole project: it
reads the drawing, changes it, exports it, and puts its actions in the toolbar.

Plugins ship inside libraries, because a library is already the unit swcad loads, watches and
hot-reloads. A library may contain only plugins and no components at all — it then contributes
nothing to the palette and everything to the toolbar.

```
libs/align/
  library.json
  plugins/align.js        one plugin per file; every .js under plugins/ is loaded
```

Nothing needs to be declared in `library.json`: the folder is the manifest.

## Registering

A plugin file runs once, in the same sandbox a component script runs in, and registers itself:

```js
definePlugin({
  id: 'align',                       // optional; defaults to <libId>/<file stem>
  title: 'Align',                    // the toolbar group's name
  description: 'Tidy up positions.',
  commands: [ /* … */ ],
});
```

A plugin with no commands is reported as an error rather than ignored — a plugin that registers
nothing is a plugin that failed.

## Commands

```js
{
  id: 'export.svg',
  label: 'Export',                   // the accessible name of the button
  hint: 'Export as SVG',             // tooltip, and the second line in a menu entry
  icon: 'download',                  // a name from the icon set, see below
  run: (ctx) => { … },               // what clicking it does
  enabled: (ctx) => boolean,         // greyed out when false
  active: (ctx) => boolean,          // drawn pressed when true
  items: [ /* more commands */ ],    // turns the button into a split button
  separator: true,                   // (menu entries) draw a rule above this one
}
```

A command with `items` is rendered as a **split button**: the main half runs `run`, the caret
opens the entries. A command with `items` and no `run` is a plain menu. Entries may not nest more
than one level deep.

`enabled` and `active` are called on every render with a context built for reading — do not mutate
from them, and keep them cheap.

Everything a single `run` changes lands in **one undo entry**, labelled with the command. If `run`
returns a promise (an export that has to rasterise, say) it is awaited, and a rejection is
reported to the user; nothing it does after returning touches the document.

A command that overruns 400 ms is logged as slow. A command that throws is caught, reported in a
dialog, and leaves the document as the transaction left it.

## Icons

A plugin cannot hand over a React element and has no business knowing which icon set the app
draws from, so it names one:

`align`, `align-left`, `align-right`, `align-top`, `align-bottom`, `align-center-h`,
`align-center-v`, `distribute-h`, `distribute-v`, `grid`, `layout`, `arrow-down`,
`arrow-right`, `download`, `code`, `image`, `document`, `warning`.

An unknown name falls back to a neutral dot. Add new names to `PLUGIN_ICONS` in
`src/editor/PluginToolbar.tsx`.

## The context

`ctx` is a flat snapshot of the drawing taken the moment the command was clicked. Mutations do not
rewrite it, so a command can read its plan once and then apply it without the ground moving.

### Reading

| Field | What it is |
|---|---|
| `ctx.mode` | `'sheet'` or `'component'` — which canvas is on screen |
| `ctx.doc` | `{ title, name, kind, page }`. `name` is a file-safe stem for downloads; `page` is `{ preset, width, height, orientation }` in millimetres, or `null` on an endless sheet |
| `ctx.grid` | `{ size, subdivisions, originX, originY, unit, snap, step }`. `step` is the spacing actually drawn and snapped to; `snap` is the toolbar toggle |
| `ctx.nodes` | Every node, in paint order (see below) |
| `ctx.connections` | `{ id, ref, from, to, selected }`; endpoints are `{ kind, nodeId?, portId?, x?, y? }` |
| `ctx.selection` | Ids of everything selected, nodes and connections alike |
| `ctx.selected()` | The selected **nodes**, in document order |
| `ctx.node(id)` | One node, or `null` |

A node:

| Field | What it is |
|---|---|
| `id`, `ref`, `name` | Identity, `libId/componentId`, and the component's display name |
| `x`, `y`, `w`, `h`, `rotation` | The stored transform: the top-left of the instance box, its size, and degrees |
| `bounds` | The **painted** box — geometry only, no captions or invisible hit rectangles. This is the box the alignment guides are drawn from, and what you almost always want to line up |
| `extent` | Everything the node paints, labels included |
| `params` | The instance's parameters |
| `ports` | `{ id, name, x, y, connected }` in world coordinates |
| `selected`, `locked`, `attached` | `attached` means the node is pinned to another node's anchor, so its position is not its own to set |

### Writing

| Call | Effect |
|---|---|
| `ctx.move(id, x, y)` | Set the position |
| `ctx.moveBy(id, dx, dy)` | Relative to the position in the snapshot |
| `ctx.resize(id, w, h)` | Set the size |
| `ctx.rotate(id, degrees)` | Set the rotation |
| `ctx.setParam(id, name, value)` | Set one parameter |
| `ctx.remove(id)` | Delete a node or a connection |
| `ctx.select(ids)` | Replace the selection |
| `ctx.snapToGrid(value)` | Round a coordinate onto the lattice, whether or not snapping is on |

`move`, `moveBy`, `resize` and `rotate` refuse to touch a locked or attached node. There is no
way to create a node from a plugin yet.

### Capabilities

Everything that needs the DOM is lent by the app, so the sandbox itself stays closed:

| Call | Effect |
|---|---|
| `ctx.svg({ selection })` | The drawing as SVG text. Defaults to the selection when there is one |
| `ctx.download(name, text, mime)` | Offer a text file |
| `ctx.downloadPng(name, svg, scale)` | Rasterise and offer a PNG. Returns a promise — return it from `run` |
| `ctx.print(svg, title)` | Open the print dialogue, which is how a PDF is made |
| `ctx.notify(message, title)` | Say something in the app's own modal |

## The sandbox

Identical to the one component scripts run in: `Math`, `JSON`, `Object`, `Array`, `String`,
`Number`, `Boolean`, `Map`, `Set`, `Symbol`, `Date`, the error constructors, the numeric globals
and `console`. Every other identifier throws a `ReferenceError`, so there is no path to the DOM,
the network, timers or storage. It is isolation by capability removal, not a security boundary:
an infinite loop still freezes the tab.

## Hot reload

The server watches both library roots. Saving a plugin file reloads the libraries, which bumps the
registry revision, which recompiles every plugin — the toolbar picks the change up without a
reload.

## Worked example

`libs/align/plugins/align.js` is the reference implementation, and the one place a plugin reads
the *shape* of the drawing rather than its coordinates. `Arrange` is a layered graph layout: it
turns `ctx.connections` into a graph, reverses whatever closes a loop, ranks the nodes along the
flow, orders each rank to cut connector crossings, and only then works out coordinates.

Two details are worth copying.

**Line things up by the painted shape, keep them apart by everything it paints.** `bounds` is the
box the eye reads, so that is what is centred on a rank. The room a component needs is the union
of `bounds` and `extent` — measured separately on each side of the centre, because a caption
hangs off the bottom only:

```js
const left = Math.min(b.x, e.x);
const right = Math.max(b.x + b.w, e.x + e.w);
const room = { back: cx - left, front: right - cx };
```

Note what is *not* in there: the instance box `x/y/w/h`. A component may draw wherever it likes
inside its box and many ignore it altogether — every `software/*` icon paints the same size no
matter how the instance was sized — so reserving the box leaves a slab of empty space beside one
part and none beside the next, and a rank of mixed sizes reads as randomly spaced. Space two
neighbours by their facing halves plus a fixed gap and the clear space between them is the same
all the way along, whatever sizes they are.

**Round positions, not the boxes you lined up.** Clustering and centring read `bounds`; the grid
rounding is applied to `x`/`y`, which is what dragging snaps, so a node dropped afterwards does
not jump:

```js
const settle = (node, delta) => {
  if (!ctx.grid.snap) return delta;
  const pos = node.x + delta;
  return ctx.snapToGrid(pos) - node.x;
};
```

That leaves one trap. Rounding each position on its own moves each part by its own amount, so a
gap can come out a whole cell wider than the one beside it. Work in whole cells — round each
gap up to `ctx.grid.step`, and round the offset between a node's position and its painted centre
too — and the whole rank rounds by the same amount, keeping the spacing the layout worked out.

`libs/export/plugins/export.js` is the smaller one: five entries, all of them one line.
