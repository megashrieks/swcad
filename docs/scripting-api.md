# Scripting API

Component scripts are plain JavaScript — no build step, no modules, no `import`. A script
registers itself by calling `defineComponent`:

```js
defineComponent({
  render(ctx) { return null; },   // return SVG, or null to keep the authored geometry
  style(ctx)  { return {};   },   // restyle fill_slot regions
  ports(ctx)  { return [];   },   // optional dynamic ports
});
```

All three hooks are optional and synchronous.

## The sandbox

Scripts run on the main thread inside a `with`-scoped strict-mode function whose scope proxy
resolves only the identifiers listed below. `window`, `document`, `globalThis`, `fetch`, `eval`,
`setTimeout`, `Worker` and every other ambient global raise a `ReferenceError`, and the usual
`this.constructor.constructor` escape is blocked. Assigning to an undeclared identifier throws;
declare your helpers with `var`/`function`/`const` and they resolve to the script's own scope.

Available globals: `Math`, `JSON`, `Object`, `Array`, `String`, `Number`, `Boolean`, `Map`, `Set`,
`Symbol`, `Date`, the `Error` types, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, and a frozen
`console`. Use `Date` for *formatting* only — take the timestamp from `ctx.env.now` so the
component is subscribed to the clock tick and actually re-renders.

The API objects are injected as bare identifiers too, so `svg.path(...)` and `route.orthogonal(...)`
work without going through `ctx`:

| Global | What it is |
|---|---|
| `defineComponent(hooks)` | registration |
| `svg` | the virtual-node builder |
| `geometry` | vector/rect/path maths |
| `route` | routing helpers |
| `require(name)` | load a `shared/` module |

Every hook has a wall-clock budget; overruns and thrown errors are captured and surfaced in the
inspector instead of breaking the render. This is *isolation by capability removal*, not a
security boundary — an infinite loop still freezes the tab.

## `ctx` for node components

| Field | Description |
|---|---|
| `ctx.node` | `{ id, ref, x, y, rot, scaleX, scaleY }` — the resolved world transform. `scaleX`/`scaleY` are informational only; geometry returned by `render()` is never rescaled |
| `ctx.size` | `{ w, h }` of the instance — draw at this size directly |
| `ctx.params` | frozen copy of the instance parameters |
| `ctx.ports` | `[{ id, name, direction, connected, pos, localPos, facing, group? }]` — `group` lists the ids of every same-named port on the node when there is more than one; such ports are one logical port and share `connected` and their connection list |
| `ctx.graph` | graph queries, see below |
| `ctx.env` | `{ now, tick, unit, grid }` |
| `ctx.log(...)` | writes to the inspector's script output |

## `ctx` for connector components

| Field | Description |
|---|---|
| `ctx.connection` | `{ id, from: { pos, facing }, to: { pos, facing }, waypoints }` |
| `ctx.params` | connector parameters |
| `ctx.obstacles` | node bounds near the route, excluding the two endpoints' own nodes |
| `ctx.graph`, `ctx.env`, `ctx.log` | as above |

## `ctx.graph`

| Call | Returns |
|---|---|
| `node(id)` | a snapshot `{ id, ref, x, y, w, h, params, ports, bounds }` or `null` |
| `nodes()` | every node snapshot — **always recomputes**, prefer a narrower query |
| `nodesInRect(rect)` | nodes overlapping a world-space rect |
| `connectionsOf(nodeId, portId?)` | `{ id, from, to, params }` for the connections touching a node/port — a `portId` in a same-named group answers for the whole group |
| `neighbors(nodeId)` | node snapshots on the other end of connected edges |
| `meta()` | the document metadata (`title`, `author`, `revision`, `date`, …) |

Every read is recorded as a dependency key, so a component that inspects a region is only
recomputed when something inside *that region* changes:

| Read | Key |
|---|---|
| `graph.node(id)` | `node:<id>` |
| `graph.nodesInRect(r)` | one `bucket:<x>,<y>` per spatial-hash bucket the rect touches |
| `graph.connectionsOf(id)` | `ports:<id>` plus `conn:<id>` per edge |
| `graph.meta()` | `doc:meta` |
| `env.now` / `env.tick` | `clock:minute` |
| `graph.nodes()` | `*` (recompute every frame) |

## `svg`

`svg.g`, `svg.path`, `svg.rect`, `svg.circle`, `svg.ellipse`, `svg.line`, `svg.polyline`,
`svg.polygon`, `svg.text`, `svg.use`.

```js
svg.g({ opacity: 0.9 }, [
  svg.rect({ x: 0, y: 0, width: 100, height: 40, rx: 4, fill: '#eef' }),
  svg.text('hello', { x: 50, y: 25, 'text-anchor': 'middle', 'font-size': 12 }),
]);
```

Attributes with a `null`/`undefined` value are dropped. Output is sanitised: unknown tags,
`on*` handlers, `href`, `javascript:` and `data:` URLs are stripped. `data-swcad-*` survives.

## `geometry`

`add`, `sub`, `scale`, `length`, `normalize`, `distance`, `rect`, `rectFromPoints`,
`transformedBounds`, `snapTo`, `polylinePath(points, radius)`, `smoothPath(points)`,
`pointAtLength(points, len)`, `polylineLength(points)`, `distToSegment(p, a, b)`.

## `route`

| Call | Description |
|---|---|
| `route.orthogonal(a, b, opts)` | A* search over a lattice built from the obstacles' own edges |
| `route.straight(a, b, opts)` | direct, honouring waypoints |
| `route.curve(a, b, opts)` | smooth path through the computed points |
| `route.arrowHead(tip, from, size)` | three points for an arrowhead polygon |

`opts`: `{ fromFacing, toFacing, waypoints, obstacles, stub, clearance, router, bendPenalty, grid, gridOrigin }`.

`route.orthogonal` leaves each port along its normal, then searches for the cheapest
collision-free staircase, where cost is length plus `bendPenalty` per corner (0 on the arrow,
25 when the option is omitted) —
so it goes around whole arrangements of nodes rather than picking the least-bad of a few
elbow shapes. It never retraces an exit stub. `router: 'simple'` selects the old
candidate-shape search, which is what the engine also falls back to when the lattice is too
large or the endpoints are genuinely walled in.

`grid` makes the router search the document's grid lines first, so connectors run along the
lines that are actually drawn; only the short stub segments off the ports leave the grid. The
engine fills it in automatically from the sheet grid whenever snapping is on (`gridOrigin`
follows the grid origin), so scripts get grid-aligned routes for free — pass `grid: 0` to opt
out. When no grid-aligned route exists, the search falls back to the obstacle lattice.

## `require`

`require('lib:style')` loads `shared/style.js` from the component's own library;
`require('other:helpers')` loads it from another library.

A shared module is compiled by the same sandbox as a component, so it **exports by calling
`defineComponent`** — there is no `module` or `exports` binding. Whatever object it passes is what
`require` returns, and it gets `svg`, `geometry`, `route` and `require` in scope:

```js
// libs/base/shared/style.js
defineComponent({
  applyFill: function (params) {
    return { fill: params.fill || 'var(--sw-surface)', stroke: params.stroke || 'var(--sw-ink)' };
  },
});
```

```js
// any component in libs/base
var style = require('lib:style');
```

Every file under a library's `shared/` directory is loaded, whether or not the manifest lists it;
listing it in `library.json`'s `shared` array is documentation for the reader.

## Hook contracts

### `render(ctx) -> VNode | VNode[] | null`

Return `null` (or nothing) to keep the authored geometry — most components do. Returning nodes
replaces the geometry entirely, so ports and labels must come from the returned tree (tag elements
with `data-swcad-port` / `data-swcad-label`) or from `ports()`.

### `style(ctx) -> { slots: { <slotName>: { <attr>: value } } }`

Merged onto the elements annotated as `fill_slot`. Cheap; prefer it over `render` for state colour.

A returned colour may be a literal (`'#2e3440'`, fixed forever) or a theme token
(`'var(--sw-success)'`), which follows whichever palette the drawing is viewed in and is baked into
its resolved value on export. See *Colours: fixed or borrowed* in
[authoring-components.md](authoring-components.md) for the full token list.

### `ports(ctx) -> [{ id, name, direction, x, y, facing }]`

Replaces or extends the annotated ports. Coordinates are in local (pre-transform) space.

## Examples

**React to connection state** (a component may inspect `ctx.ports` and restyle itself):

```js
defineComponent({
  style(ctx) {
    var p = ctx.params;
    var connected = ctx.ports.length > 0 && ctx.ports.every(function (x) { return x.connected; });
    return { slots: { body: { fill: p.fill || '#ffffff', stroke: connected ? '#2e3440' : '#b0b6c0' } } };
  },
});
```

**A self-routing arrow** (`libs/base/components/arrow/script.js`, abridged):

```js
defineComponent({
  render(ctx) {
    var a = ctx.connection.from;
    var b = ctx.connection.to;
    var pts = route.orthogonal(a.pos, b.pos, {
      fromFacing: a.facing,
      toFacing: b.facing,
      waypoints: ctx.connection.waypoints,
      obstacles: ctx.obstacles,
    });
    return svg.g({}, [
      svg.path({
        d: geometry.polylinePath(pts, 6),
        fill: 'none',
        stroke: '#3b4252',
        'stroke-width': 1.6,
        'data-swcad-route': JSON.stringify(pts),
      }),
    ]);
  },
});
```

**Time-dependent styling** — reading `ctx.env.now` subscribes the component to a per-minute tick:

```js
defineComponent({
  style(ctx) {
    var weekend = [0, 6].indexOf(new Date(ctx.env.now).getDay()) >= 0;
    return { slots: { body: { fill: weekend ? '#fde2e2' : '#ffffff' } } };
  },
});
```

## Caveats

- Node scripts run in a single pass per frame using the previous stage's data, so
  script-to-script cross-references settle on the *next* frame.
- Scripts must be pure and synchronous. There is no I/O, no timers and no persistent state
  between invocations; keep everything derived from `ctx`.
- There is no `Math.random`. A generative component needs a seeded generator so the same document
  always draws the same picture — see `libs/generative/shared/random.js`, which every component in
  that library loads with `require('lib:random')`.
- A script that returns nodes bypasses `scaleGeometry`: its output is used verbatim. A `resizable`
  scripted component must therefore draw to `ctx.size` itself rather than expect the engine to
  stretch it.
- Palette thumbnails are drawn from `shape.svg`, never by running the script. A scripted component
  with no `shape.svg` shows a blank tile.
- A hook that runs longer than the script budget (8ms) is reported as a *warning* in the inspector,
  not an error. Its output is still used and cached, so an expensive generative component is slow,
  not broken.
