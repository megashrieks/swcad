/**
 * Arrange — untangle a drawing by reading its connectors.
 *
 * The default action is a layered graph layout, the same family of algorithm dot(1) uses.
 * It reads the connections rather than the coordinates: it decides which way the drawing
 * flows, sorts the components into ranks along that flow, then orders each rank so that
 * as few connectors cross as possible, and finally spaces things out so long connectors
 * run straight. The result is a drawing you can follow with a finger — which is what a
 * diagram of forty boxes and sixty arrows stops being once it has been dragged around for
 * an afternoon.
 *
 * It works on the selection when two or more things are selected, and on the whole sheet
 * otherwise. Locked nodes and nodes attached to another node's anchor are never moved: an
 * attached node's position belongs to its parent, and a locked node is locked. Connectors
 * are not moved either — they are routed from their endpoints, so moving the boxes is the
 * whole job.
 *
 * The menu keeps the smaller, explicit tools: tidying near-misses, aligning edges,
 * equalising gaps, and putting everything back on the lattice.
 */

/* ------------------------------------------------------------------ shared */

function movable(node) {
  return !node.locked && !node.attached;
}

function workingSet(ctx) {
  const selected = ctx.selected().filter(movable);
  if (selected.length >= 2) return selected;
  return ctx.nodes.filter(movable);
}

function byId(nodes) {
  const map = new Map();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

function centreOf(node, axis) {
  const b = node.bounds;
  return axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort(function (a, b) {
    return a - b;
  });
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Grid rounding lands on the node's *position*, which is what dragging snaps to, so an
 * arranged drawing never leaves a coordinate off the lattice. A component may draw its
 * box anywhere inside its instance, so a part whose painted centre sits half a cell from
 * its position ends up half a cell off its rank line; the layout works in whole cells
 * everywhere else, so that half cell is the whole of the error and it never compounds.
 */
function settle(ctx, node, axis, delta) {
  if (!ctx.grid.snap) return delta;
  const pos = axis === 'x' ? node.x : node.y;
  return ctx.snapToGrid(pos + delta) - pos;
}

function moveNodes(ctx, moves) {
  let moved = 0;
  for (const move of moves) {
    if (Math.abs(move.dx) < 0.001 && Math.abs(move.dy) < 0.001) continue;
    ctx.moveBy(move.id, move.dx, move.dy);
    moved += 1;
  }
  return moved;
}

/* ------------------------------------------------------------------- graph */

/**
 * The connectors, as a plain directed graph over the nodes we are allowed to move.
 * Endpoints that hang in space, or land on something locked, are not edges: there is
 * nothing at the other end for the layout to reason about. Parallel connectors collapse —
 * two arrows between the same pair say no more about the layout than one does.
 */
function edgesOf(ctx, nodes) {
  const allowed = new Set(nodes.map(function (n) {
    return n.id;
  }));
  const seen = new Set();
  const edges = [];
  for (const conn of ctx.connections) {
    const from = conn.from.nodeId;
    const to = conn.to.nodeId;
    if (!from || !to || from === to) continue;
    if (!allowed.has(from) || !allowed.has(to)) continue;
    const key = from + '\u0000' + to;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: from, to: to });
  }
  return edges;
}

function adjacency(nodes, edges) {
  const out = new Map();
  for (const node of nodes) out.set(node.id, []);
  for (const edge of edges) out.get(edge.from).push(edge.to);
  return out;
}

/** Which way the drawing already flows, so an arrange feels like a tidy and not a rewrite. */
function inferAxis(nodes, edges) {
  const map = byId(nodes);
  let across = 0;
  let down = 0;
  for (const edge of edges) {
    const a = map.get(edge.from);
    const b = map.get(edge.to);
    across += Math.abs(centreOf(b, 'x') - centreOf(a, 'x'));
    down += Math.abs(centreOf(b, 'y') - centreOf(a, 'y'));
  }
  return across > down ? 'right' : 'down';
}

/** Connected pieces of the drawing, ignoring which way the arrows point. */
function componentsOf(ids, out) {
  const near = new Map();
  for (const id of ids) near.set(id, []);
  for (const id of ids) {
    for (const other of out.get(id)) {
      near.get(id).push(other);
      near.get(other).push(id);
    }
  }
  const seen = new Set();
  const groups = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const stack = [id];
    const group = [];
    while (stack.length > 0) {
      const current = stack.pop();
      group.push(current);
      for (const other of near.get(current)) {
        if (seen.has(other)) continue;
        seen.add(other);
        stack.push(other);
      }
    }
    groups.push(group);
  }
  return groups;
}

/* ------------------------------------------------------- layers and ranks */

/**
 * A layered layout needs a direction of travel, and a drawing may well contain a loop.
 * Depth-first search finds the connectors that close a loop and turns them round for the
 * duration: they are laid out as though they ran the other way, which is what makes the
 * rest of the drawing readable, and they are still drawn where they always were.
 */
function acyclic(ids, out, seedOf) {
  const order = ids.slice().sort(function (a, b) {
    return seedOf(a) - seedOf(b);
  });
  const state = new Map();
  const dag = new Map();
  for (const id of ids) dag.set(id, []);
  const link = function (from, to) {
    if (from === to) return;
    const edges = dag.get(from);
    if (edges.indexOf(to) < 0) edges.push(to);
  };

  for (const root of order) {
    if (state.get(root)) continue;
    const stack = [{ id: root, next: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = out.get(frame.id);
      if (frame.next >= neighbours.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const target = neighbours[frame.next];
      frame.next += 1;
      const seen = state.get(target) || 0;
      if (seen === 1) {
        // Closes a loop: lay it out reversed.
        link(target, frame.id);
      } else {
        link(frame.id, target);
        if (seen === 0) {
          state.set(target, 1);
          stack.push({ id: target, next: 0 });
        }
      }
    }
  }
  return dag;
}

function topological(ids, dag) {
  const indegree = new Map();
  for (const id of ids) indegree.set(id, 0);
  for (const id of ids) for (const to of dag.get(id)) indegree.set(to, indegree.get(to) + 1);
  const queue = ids.filter(function (id) {
    return indegree.get(id) === 0;
  });
  const order = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    order.push(id);
    for (const to of dag.get(id)) {
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return order;
}

/**
 * Rank by longest path, then pull each node down until it sits just above its earliest
 * successor. The second pass is what stops a source that feeds one distant box from
 * sitting alone at the top of the drawing with a connector running past everything.
 */
function ranksOf(ids, dag) {
  const order = topological(ids, dag);
  const rank = new Map();
  for (const id of ids) rank.set(id, 0);
  for (const id of order) {
    for (const to of dag.get(id)) rank.set(to, Math.max(rank.get(to), rank.get(id) + 1));
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const successors = dag.get(id);
    if (successors.length === 0) continue;
    let earliest = Infinity;
    for (const to of successors) earliest = Math.min(earliest, rank.get(to));
    if (earliest - 1 > rank.get(id)) rank.set(id, earliest - 1);
  }
  return rank;
}

/**
 * Build the layers, replacing every connector that skips a rank with a chain of invisible
 * placeholders. They cost nothing to draw and they are the reason a long connector comes
 * out straight instead of cutting diagonally through the boxes in between.
 */
function buildLayers(ids, dag, rank, geometry) {
  const layers = [];
  const vertexOf = new Map();
  const put = function (vertex) {
    while (layers.length <= vertex.layer) layers.push([]);
    layers[vertex.layer].push(vertex);
    return vertex;
  };

  for (const id of ids) {
    const room = geometry.room(id);
    vertexOf.set(
      id,
      put({
        id: id,
        dummy: false,
        layer: rank.get(id),
        back: room.back,
        front: room.front,
        alongBack: room.alongBack,
        alongFront: room.alongFront,
        seed: geometry.seed(id),
        pos: 0,
        prev: [],
        next: [],
      }),
    );
  }

  for (const id of ids) {
    for (const to of dag.get(id)) {
      const from = vertexOf.get(id);
      const target = vertexOf.get(to);
      let previous = from;
      for (let layer = from.layer + 1; layer < target.layer; layer += 1) {
        const share = (layer - from.layer) / (target.layer - from.layer);
        const dummy = put({
          id: null,
          dummy: true,
          layer: layer,
          back: 0,
          front: 0,
          alongBack: 0,
          alongFront: 0,
          seed: from.seed + (target.seed - from.seed) * share,
          pos: 0,
          prev: [],
          next: [],
        });
        previous.next.push(dummy);
        dummy.prev.push(previous);
        previous = dummy;
      }
      previous.next.push(target);
      target.prev.push(previous);
    }
  }
  return layers;
}

/* --------------------------------------------------- crossing minimisation */

function countCrossings(upper, lower) {
  const above = new Map();
  for (let i = 0; i < upper.length; i += 1) above.set(upper[i], i);
  const pairs = [];
  for (let i = 0; i < lower.length; i += 1) {
    for (const parent of lower[i].prev) {
      const at = above.get(parent);
      if (at !== undefined) pairs.push([at, i]);
    }
  }
  let crossings = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) crossings += 1;
    }
  }
  return crossings;
}

function totalCrossings(layers) {
  let total = 0;
  for (let i = 1; i < layers.length; i += 1) total += countCrossings(layers[i - 1], layers[i]);
  return total;
}

/** Sort one layer by the median position of each vertex's neighbours in the fixed layer. */
function sortByMedian(layer, reference, side) {
  const at = new Map();
  for (let i = 0; i < reference.length; i += 1) at.set(reference[i], i);
  const keyed = layer.map(function (vertex, index) {
    const positions = [];
    for (const neighbour of vertex[side]) {
      const found = at.get(neighbour);
      if (found !== undefined) positions.push(found);
    }
    const value = median(positions);
    return { vertex: vertex, index: index, key: value === null ? index : value };
  });
  keyed.sort(function (a, b) {
    return a.key - b.key || a.index - b.index;
  });
  for (let i = 0; i < keyed.length; i += 1) layer[i] = keyed[i].vertex;
}

/** Swap neighbours whenever it removes a crossing — the cheap pass the median misses. */
function transpose(layers) {
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      for (let j = 0; j + 1 < layer.length; j += 1) {
        const before =
          (i > 0 ? countCrossings(layers[i - 1], layer) : 0) +
          (i + 1 < layers.length ? countCrossings(layer, layers[i + 1]) : 0);
        const held = layer[j];
        layer[j] = layer[j + 1];
        layer[j + 1] = held;
        const after =
          (i > 0 ? countCrossings(layers[i - 1], layer) : 0) +
          (i + 1 < layers.length ? countCrossings(layer, layers[i + 1]) : 0);
        if (after < before) improved = true;
        else {
          layer[j + 1] = layer[j];
          layer[j] = held;
        }
      }
    }
    if (!improved) return;
  }
}

function orderLayers(layers, sweeps) {
  let count = 0;
  for (const layer of layers) {
    count += layer.length;
    layer.sort(function (a, b) {
      return a.seed - b.seed;
    });
  }
  // Swapping pairs costs a recount of both neighbouring layers; past a certain size the
  // medians alone are the better bargain.
  const swaps = count <= 150;
  let best = layers.map(function (layer) {
    return layer.slice();
  });
  let bestCost = totalCrossings(layers);

  for (let sweep = 0; sweep < sweeps && bestCost > 0; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let i = 1; i < layers.length; i += 1) sortByMedian(layers[i], layers[i - 1], 'prev');
    } else {
      for (let i = layers.length - 2; i >= 0; i -= 1) sortByMedian(layers[i], layers[i + 1], 'next');
    }
    if (swaps) transpose(layers);
    const cost = totalCrossings(layers);
    if (cost < bestCost) {
      bestCost = cost;
      best = layers.map(function (layer) {
        return layer.slice();
      });
    }
  }
  for (let i = 0; i < layers.length; i += 1) layers[i] = best[i];
  return bestCost;
}

/* ---------------------------------------------------------- across the flow */

/**
 * How much clear space to leave between two neighbours in a rank.
 *
 * The space is measured from the end of one component to the start of the next, not
 * between their centres, and the room a component takes is not the same on both sides: a
 * caption hangs below the shape, an icon sits in a box wider than itself. Adding the two
 * facing halves and one constant gap is what makes a row of mixed sizes read as evenly
 * spaced — the gaps are all the same even though the components are not. A placeholder on
 * a long connector is only a channel for a line, so it asks for half the gap and no room
 * of its own.
 */
function separation(a, b, gap) {
  return a.front + (a.dummy || b.dummy ? gap / 2 : gap) + b.back;
}

/**
 * Positions across the flow, by the priority method: each vertex would like to sit at the
 * median of the things it connects to in the layer next door, and the ones with most to
 * say get to ask first. Placeholders on a long connector outrank everything, which is
 * what pulls that connector into a straight line; a vertex may push its unplaced
 * neighbours along but never past something already settled.
 */
function assignAcross(layers, spacing) {
  const gap = spacing.across;
  for (const layer of layers) {
    let cursor = 0;
    for (let i = 0; i < layer.length; i += 1) {
      const vertex = layer[i];
      if (i > 0) cursor += separation(layer[i - 1], vertex, gap);
      vertex.pos = cursor;
    }
  }

  const priority = function (vertex) {
    return vertex.dummy ? 1e6 : vertex.prev.length + vertex.next.length;
  };

  const shift = function (layer, index, target, settled) {
    const vertex = layer[index];
    const delta = target - vertex.pos;
    if (Math.abs(delta) < 0.001) return;

    if (delta > 0) {
      let room = Infinity;
      let span = 0;
      for (let j = index + 1; j < layer.length; j += 1) {
        span += separation(layer[j - 1], layer[j], gap);
        if (settled.has(layer[j])) {
          room = layer[j].pos - span;
          break;
        }
      }
      const next = Math.min(target, room);
      if (next <= vertex.pos) return;
      vertex.pos = next;
      for (let j = index + 1; j < layer.length; j += 1) {
        const least = layer[j - 1].pos + separation(layer[j - 1], layer[j], gap);
        if (layer[j].pos >= least) break;
        layer[j].pos = least;
      }
    } else {
      let room = -Infinity;
      let span = 0;
      for (let j = index - 1; j >= 0; j -= 1) {
        span += separation(layer[j], layer[j + 1], gap);
        if (settled.has(layer[j])) {
          room = layer[j].pos + span;
          break;
        }
      }
      const next = Math.max(target, room);
      if (next >= vertex.pos) return;
      vertex.pos = next;
      for (let j = index - 1; j >= 0; j -= 1) {
        const most = layer[j + 1].pos - separation(layer[j], layer[j + 1], gap);
        if (layer[j].pos <= most) break;
        layer[j].pos = most;
      }
    }
  };

  for (let sweep = 0; sweep < 6; sweep += 1) {
    const downward = sweep % 2 === 0;
    const first = downward ? 1 : layers.length - 2;
    const step = downward ? 1 : -1;
    for (let i = first; i >= 0 && i < layers.length; i += step) {
      const layer = layers[i];
      const side = downward ? 'prev' : 'next';
      const settled = new Set();
      const queue = layer.map(function (vertex, index) {
        return index;
      });
      queue.sort(function (a, b) {
        return priority(layer[b]) - priority(layer[a]);
      });
      for (const index of queue) {
        const vertex = layer[index];
        const target = median(
          vertex[side].map(function (neighbour) {
            return neighbour.pos;
          }),
        );
        if (target !== null) shift(layer, index, target, settled);
        settled.add(vertex);
      }
    }
  }

  // Land every position a whole number of cells from the next. Rounding the finished
  // drawing onto the grid then moves a whole layer by the same amount, so it cannot open
  // one gap a cell wider than the one beside it. Order and clearance are kept.
  for (const layer of layers) {
    let prev = null;
    for (const vertex of layer) {
      let pos = spacing.lattice(vertex.pos);
      if (prev !== null) {
        pos = Math.max(pos, prev.pos + spacing.quantise(separation(prev, vertex, gap)));
      }
      vertex.pos = pos;
      prev = vertex;
    }
  }
}

/* -------------------------------------------------------------- the layout */

/**
 * Lay out one connected piece. Returns the centre each node should end up at, in the
 * piece's own coordinates: `across` runs left to right of the flow, `along` runs with it.
 */
function layoutPiece(ids, out, geometry, spacing) {
  const dag = acyclic(ids, out, geometry.seed);
  const rank = ranksOf(ids, dag);
  const layers = buildLayers(ids, dag, rank, geometry);
  orderLayers(layers, ids.length > 60 ? 4 : 8);
  assignAcross(layers, spacing);

  const places = new Map();

  // Ranks are spaced by the clear space between them, not by the distance between their
  // centres: what the eye measures is the gap from the end of one component to the start
  // of the next, and a run of mixed sizes only reads as regular if that gap is the same
  // every time. So each rank is set down one clear gap past the deepest edge of the one
  // before it.
  let line = 0;
  let behind = 0;
  for (let i = 0; i < layers.length; i += 1) {
    let back = 0;
    let front = 0;
    for (const vertex of layers[i]) {
      back = Math.max(back, vertex.alongBack);
      front = Math.max(front, vertex.alongFront);
    }
    line = i === 0 ? back : line + spacing.quantise(behind + spacing.along + back);
    for (const vertex of layers[i]) {
      if (!vertex.dummy) places.set(vertex.id, { across: vertex.pos, along: line });
    }
    behind = front;
  }
  return places;
}

/** Everything with no connectors at all, packed into a block instead of left in the way. */
function looseBlock(nodes, geometry, spacing) {
  const sorted = nodes.slice().sort(function (a, b) {
    return geometry.sortKey(a) - geometry.sortKey(b);
  });
  const columns = Math.max(1, Math.round(Math.sqrt(sorted.length)));
  let cell = 0;
  for (const node of sorted) {
    const room = geometry.room(node.id);
    cell = Math.max(cell, room.back + room.front, room.alongBack + room.alongFront);
  }
  const pitchAcross = spacing.quantise(cell + spacing.across);
  const pitchAlong = spacing.quantise(cell + spacing.along);

  const places = new Map();
  for (let i = 0; i < sorted.length; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    places.set(sorted[i].id, {
      across: column * pitchAcross + cell / 2,
      along: row * pitchAlong + cell / 2,
    });
  }
  return places;
}

function boxOf(places, geometry) {
  let minAcross = Infinity;
  let maxAcross = -Infinity;
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  for (const [id, place] of places) {
    const room = geometry.room(id);
    minAcross = Math.min(minAcross, place.across - room.back);
    maxAcross = Math.max(maxAcross, place.across + room.front);
    minAlong = Math.min(minAlong, place.along - room.alongBack);
    maxAlong = Math.max(maxAlong, place.along + room.alongFront);
  }
  return { minAcross: minAcross, maxAcross: maxAcross, minAlong: minAlong, maxAlong: maxAlong };
}

/**
 * The whole arrangement: every connected piece laid out on its own, then the pieces set
 * side by side across the flow in the order they already appear in, so a drawing made of
 * three separate diagrams stays three separate diagrams.
 */
function arrangement(ctx, nodes, edges, direction) {
  const vertical = direction === 'down';
  const map = byId(nodes);
  const grid = ctx.grid.size > 0 ? ctx.grid.size : 10;
  // Spacing is judged in whole grid cells, but rounding uses the finer line the toolbar
  // actually snaps to, so a subdivided grid is rounded to less than a whole cell.
  const step = ctx.grid.step > 0 ? ctx.grid.step : grid;

  // How much space each component actually takes, measured either side of the point it is
  // lined up by. The room is everything it paints, captions included — not the instance
  // box, because a component is free to draw wherever it likes inside that box and many
  // ignore it entirely, which would reserve a slab of empty space beside one part and not
  // beside the next. Line things up by the painted shape, keep them apart by the paint
  // and its labels, so an icon's caption never lands in its neighbour's lap.
  const rooms = new Map();
  for (const node of nodes) {
    const b = node.bounds;
    const e = node.extent;
    const left = Math.min(b.x, e.x);
    const right = Math.max(b.x + b.w, e.x + e.w);
    const top = Math.min(b.y, e.y);
    const bottom = Math.max(b.y + b.h, e.y + e.h);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    rooms.set(
      node.id,
      vertical
        ? { back: cx - left, front: right - cx, alongBack: cy - top, alongFront: bottom - cy }
        : { back: cy - top, front: bottom - cy, alongBack: cx - left, alongFront: right - cx },
    );
  }

  // Spacing follows the components. Both numbers are a *clear gap*: the space between the
  // end of one component and the start of the next, everything it paints included. The
  // floor comes from the typical component rather than the biggest one, so a drawing of
  // small parts is not spread out to suit a single large one.
  const widths = [];
  const depths = [];
  for (const room of rooms.values()) {
    widths.push(room.back + room.front);
    depths.push(room.alongBack + room.alongFront);
  }
  const widest = median(widths);
  const deepest = median(depths);

  const round = function (value) {
    return Math.max(step, Math.ceil(value / step) * step);
  };
  const spacing = {
    across: round(Math.max(grid * 6, widest)),
    // Along the flow sit the connectors and their labels, so that gap is the generous one.
    along: round(Math.max(grid * 8, deepest)),
    // Gaps are stepped in whole grid cells and coordinates land on the lattice, so that
    // rounding the finished drawing onto the grid shifts a whole rank at once instead of
    // nudging each part on its own and leaving one gap wider than the next.
    quantise: round,
    lattice: function (value) {
      return Math.round(value / step) * step;
    },
  };

  const geometry = {
    room: function (id) {
      return rooms.get(id);
    },
    seed: function (id) {
      return centreOf(map.get(id), vertical ? 'x' : 'y');
    },
    sortKey: function (node) {
      return centreOf(node, vertical ? 'y' : 'x') * 4096 + centreOf(node, vertical ? 'x' : 'y');
    },
  };

  const out = adjacency(nodes, edges);
  const connected = [];
  const loose = [];
  for (const group of componentsOf(
    nodes.map(function (n) {
      return n.id;
    }),
    out,
  )) {
    if (group.length > 1) connected.push(group);
    else loose.push(map.get(group[0]));
  }

  const pieces = connected.map(function (group) {
    const places = layoutPiece(group, out, geometry, spacing);
    let seed = 0;
    for (const id of group) seed += geometry.seed(id);
    return { places: places, seed: seed / group.length };
  });
  pieces.sort(function (a, b) {
    return a.seed - b.seed;
  });
  if (loose.length > 0) {
    pieces.push({ places: looseBlock(loose, geometry, spacing), seed: Infinity });
  }

  const placed = new Map();
  let cursor = 0;
  for (const piece of pieces) {
    const box = boxOf(piece.places, geometry);
    const shiftAcross = cursor - box.minAcross;
    const shiftAlong = -box.minAlong;
    for (const [id, place] of piece.places) {
      placed.set(id, { across: place.across + shiftAcross, along: place.along + shiftAlong });
    }
    cursor += box.maxAcross - box.minAcross + spacing.across * 2;
  }

  // Put the arrangement back where the drawing was, so an arrange never scrolls away.
  const wasBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const node of nodes) {
    wasBox.minX = Math.min(wasBox.minX, node.bounds.x);
    wasBox.maxX = Math.max(wasBox.maxX, node.bounds.x + node.bounds.w);
    wasBox.minY = Math.min(wasBox.minY, node.bounds.y);
    wasBox.maxY = Math.max(wasBox.maxY, node.bounds.y + node.bounds.h);
  }
  const now = boxOf(placed, geometry);
  const anchorX = (wasBox.minX + wasBox.maxX) / 2;
  const anchorY = (wasBox.minY + wasBox.maxY) / 2;
  const nowCross = (now.minAcross + now.maxAcross) / 2;
  const nowAlong = (now.minAlong + now.maxAlong) / 2;

  // A component may paint its shape anywhere inside its instance box, and that offset is
  // not always a whole number of cells. Rounding it to one before it is subtracted means
  // every node rounds onto the lattice by the same amount, so the gaps the layout worked
  // out survive the rounding intact; the price is that a part whose paint sits half a cell
  // into its box is drawn half a cell off its rank line, always by the same amount.
  const moves = [];
  for (const [id, place] of placed) {
    const node = map.get(id);
    const x = vertical
      ? anchorX + (place.across - nowCross)
      : anchorX + (place.along - nowAlong);
    const y = vertical
      ? anchorY + (place.along - nowAlong)
      : anchorY + (place.across - nowCross);
    const offX = spacing.lattice(centreOf(node, 'x') - node.x);
    const offY = spacing.lattice(centreOf(node, 'y') - node.y);
    moves.push({
      id: id,
      dx: settle(ctx, node, 'x', x - offX - node.x),
      dy: settle(ctx, node, 'y', y - offY - node.y),
    });
  }
  return moves;
}

function arrange(ctx, direction) {
  const nodes = workingSet(ctx);
  if (nodes.length < 2) {
    ctx.notify('Nothing to arrange — draw a couple of things first.', 'Arrange');
    return;
  }
  const edges = edgesOf(ctx, nodes);
  if (edges.length === 0) {
    ctx.notify(
      'Nothing here is connected, so there is no shape to lay out. Join a few things up with connectors, or use Tidy up to line up what is nearly lined up already.',
      'Arrange',
    );
    return;
  }
  const moves = arrangement(ctx, nodes, edges, direction || inferAxis(nodes, edges));
  if (moveNodes(ctx, moves) === 0) ctx.notify('The layout is already as tidy as it gets.', 'Arrange');
}

/* --------------------------------------------------------- the small tools */

/** How far apart two coordinates may be and still count as "meant to be the same". */
function tolerance(ctx) {
  const size = ctx.grid.size > 0 ? ctx.grid.size : 20;
  return size / 2;
}

/** The three coordinates a node can be lined up by, on one axis. */
function keysOf(node, axis) {
  const b = node.bounds;
  return axis === 'x'
    ? { start: b.x, middle: b.x + b.w / 2, end: b.x + b.w }
    : { start: b.y, middle: b.y + b.h / 2, end: b.y + b.h };
}

/**
 * One-dimensional clustering. Sort, then start a new cluster whenever a value is further
 * than the tolerance from the one before it *or* from the start of the cluster — the
 * second test stops a chain of near-misses dragging distant things together.
 */
function cluster(values, tol) {
  const sorted = values.slice().sort(function (a, b) {
    return a.value - b.value;
  });
  const out = [];
  let current = [];
  for (const item of sorted) {
    const last = current.length > 0 ? current[current.length - 1] : null;
    const fits = last !== null && item.value - last.value <= tol && item.value - current[0].value <= tol;
    if (fits) current.push(item);
    else {
      if (current.length > 0) out.push(current);
      current = [item];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * What each node's coordinate should become on one axis: the mean of the cluster it
 * belongs to. A node in more than one cluster (its left edge lines up with one column,
 * its centre with another) follows the bigger cluster, and on a tie the smaller move.
 *
 * Clustering reads the painted box — the same box the alignment guides are drawn from,
 * because that is the edge the eye lines up.
 */
function planAxis(ctx, nodes, axis) {
  const tol = tolerance(ctx);
  const map = byId(nodes);
  const proposals = new Map();

  for (const kind of ['start', 'middle', 'end']) {
    const values = nodes.map(function (node) {
      return { id: node.id, value: keysOf(node, axis)[kind] };
    });
    for (const group of cluster(values, tol)) {
      if (group.length < 2) continue;
      let sum = 0;
      for (const member of group) sum += member.value;
      const target = sum / group.length;
      for (const member of group) {
        const delta = settle(ctx, map.get(member.id), axis, target - member.value);
        const prev = proposals.get(member.id);
        const better =
          !prev ||
          group.length > prev.members ||
          (group.length === prev.members && Math.abs(delta) < Math.abs(prev.delta));
        if (better) proposals.set(member.id, { delta: delta, members: group.length });
      }
    }
  }

  // Anything that lines up with nothing still deserves to sit on the lattice.
  const deltas = new Map();
  for (const node of nodes) {
    const found = proposals.get(node.id);
    const position = axis === 'x' ? node.x : node.y;
    if (found) deltas.set(node.id, found.delta);
    else if (ctx.grid.snap) deltas.set(node.id, ctx.snapToGrid(position) - position);
  }
  return deltas;
}

function tidy(ctx) {
  const nodes = workingSet(ctx);
  if (nodes.length < 2) {
    ctx.notify('Nothing to tidy — draw a couple of things first.', 'Align');
    return;
  }
  const dxs = planAxis(ctx, nodes, 'x');
  const dys = planAxis(ctx, nodes, 'y');
  const moves = nodes.map(function (node) {
    return { id: node.id, dx: dxs.get(node.id) || 0, dy: dys.get(node.id) || 0 };
  });
  if (moveNodes(ctx, moves) === 0) ctx.notify('Everything is already lined up.', 'Align');
}

/** Explicit alignment: every selected node to one edge of the selection's own extent. */
function alignTo(ctx, edge) {
  const nodes = ctx.selected().filter(movable);
  if (nodes.length < 2) return;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.bounds.x);
    right = Math.max(right, node.bounds.x + node.bounds.w);
    top = Math.min(top, node.bounds.y);
    bottom = Math.max(bottom, node.bounds.y + node.bounds.h);
  }
  for (const node of nodes) {
    const b = node.bounds;
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = left - b.x;
    else if (edge === 'right') dx = right - (b.x + b.w);
    else if (edge === 'hcenter') dx = (left + right) / 2 - (b.x + b.w / 2);
    else if (edge === 'top') dy = top - b.y;
    else if (edge === 'bottom') dy = bottom - (b.y + b.h);
    else dy = (top + bottom) / 2 - (b.y + b.h / 2);
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) ctx.moveBy(node.id, dx, dy);
  }
}

/**
 * Equal gaps between neighbours, not equal centre spacing: two small boxes and one wide
 * one read as evenly spread when the *space* between them matches. The outermost two stay
 * where they are, so the group keeps its extent.
 */
function distribute(ctx, axis) {
  const nodes = ctx.selected().filter(movable);
  if (nodes.length < 3) return;
  const size = function (node) {
    return axis === 'x' ? node.bounds.w : node.bounds.h;
  };
  const start = function (node) {
    return axis === 'x' ? node.bounds.x : node.bounds.y;
  };
  const sorted = nodes.slice().sort(function (a, b) {
    return start(a) - start(b);
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = start(last) + size(last) - start(first);
  let occupied = 0;
  for (const node of sorted) occupied += size(node);
  const gap = (span - occupied) / (sorted.length - 1);

  let cursor = start(first) + size(first) + gap;
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const node = sorted[i];
    const delta = cursor - start(node);
    if (Math.abs(delta) > 0.001) {
      if (axis === 'x') ctx.moveBy(node.id, delta, 0);
      else ctx.moveBy(node.id, 0, delta);
    }
    cursor += size(node) + gap;
  }
}

/** Put every node's position back on the lattice, alignment or no alignment. */
function snapAll(ctx) {
  const nodes = workingSet(ctx);
  const moves = nodes.map(function (node) {
    return {
      id: node.id,
      dx: ctx.snapToGrid(node.x) - node.x,
      dy: ctx.snapToGrid(node.y) - node.y,
    };
  });
  if (moveNodes(ctx, moves) === 0) ctx.notify('Everything is already on the grid.', 'Align');
}

/* ----------------------------------------------------------------- commands */

const twoSelected = function (ctx) {
  return ctx.selected().filter(movable).length >= 2;
};
const threeSelected = function (ctx) {
  return ctx.selected().filter(movable).length >= 3;
};
const anythingConnected = function (ctx) {
  const nodes = workingSet(ctx);
  return nodes.length >= 2 && edgesOf(ctx, nodes).length > 0;
};

definePlugin({
  id: 'align',
  title: 'Arrange',
  description: 'Lay the drawing out along its connectors, and tidy up what is left.',
  commands: [
    {
      id: 'align.arrange',
      label: 'Arrange',
      hint: 'Untangle: follow the connectors and lay everything out in ranks, fewest crossings first',
      icon: 'layout',
      enabled: anythingConnected,
      run: function (ctx) {
        arrange(ctx, null);
      },
      items: [
        {
          id: 'align.arrange-down',
          label: 'Arrange downward',
          hint: 'Flow from top to bottom',
          icon: 'arrow-down',
          enabled: anythingConnected,
          run: function (ctx) {
            arrange(ctx, 'down');
          },
        },
        {
          id: 'align.arrange-right',
          label: 'Arrange to the right',
          hint: 'Flow from left to right',
          icon: 'arrow-right',
          enabled: anythingConnected,
          run: function (ctx) {
            arrange(ctx, 'right');
          },
        },
        {
          id: 'align.tidy',
          label: 'Tidy up',
          hint: 'Line up whatever is nearly lined up already, without moving anything far',
          icon: 'align',
          separator: true,
          run: tidy,
        },
        {
          id: 'align.left',
          label: 'Align left edges',
          icon: 'align-left',
          separator: true,
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'left');
          },
        },
        {
          id: 'align.hcenter',
          label: 'Align centres (vertical)',
          icon: 'align-center-v',
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'hcenter');
          },
        },
        {
          id: 'align.right',
          label: 'Align right edges',
          icon: 'align-right',
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'right');
          },
        },
        {
          id: 'align.top',
          label: 'Align top edges',
          icon: 'align-top',
          separator: true,
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'top');
          },
        },
        {
          id: 'align.vcenter',
          label: 'Align middles (horizontal)',
          icon: 'align-center-h',
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'vcenter');
          },
        },
        {
          id: 'align.bottom',
          label: 'Align bottom edges',
          icon: 'align-bottom',
          enabled: twoSelected,
          run: function (ctx) {
            alignTo(ctx, 'bottom');
          },
        },
        {
          id: 'align.distribute-h',
          label: 'Equal gaps across',
          hint: 'Needs three or more',
          icon: 'distribute-h',
          separator: true,
          enabled: threeSelected,
          run: function (ctx) {
            distribute(ctx, 'x');
          },
        },
        {
          id: 'align.distribute-v',
          label: 'Equal gaps down',
          hint: 'Needs three or more',
          icon: 'distribute-v',
          enabled: threeSelected,
          run: function (ctx) {
            distribute(ctx, 'y');
          },
        },
        {
          id: 'align.grid',
          label: 'Snap to grid',
          hint: 'Everything back onto the lattice',
          icon: 'grid',
          separator: true,
          run: snapAll,
        },
      ],
    },
  ],
});
