/**
 * Auto-alignment.
 *
 * A drawing made by hand is almost aligned: a row of boxes whose tops differ by three
 * units, a column whose centres wander. This plugin finds the coordinates that are nearly
 * shared and makes them exactly shared, rather than asking you to select things in the
 * right order and pick an edge — that is what the menu entries are for when you want to
 * be explicit.
 *
 * It works on the selection when two or more things are selected, and on the whole sheet
 * otherwise. Locked nodes and nodes attached to another node's anchor are never moved:
 * an attached node's position belongs to its parent.
 */

/** How far apart two coordinates may be and still count as "meant to be the same". */
function tolerance(ctx) {
  const size = ctx.grid.size > 0 ? ctx.grid.size : 20;
  return size / 2;
}

function movable(node) {
  return !node.locked && !node.attached;
}

function workingSet(ctx) {
  const selected = ctx.selected().filter(movable);
  if (selected.length >= 2) return selected;
  return ctx.nodes.filter(movable);
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
 * belongs to, snapped to the grid when snapping is on. A node in more than one cluster
 * (its left edge lines up with one column, its centre with another) follows the bigger
 * cluster, and on a tie the smaller move.
 *
 * Clustering reads the painted box — the same box the alignment guides are drawn from,
 * because that is the edge the eye lines up. The grid rounding is applied to the node's
 * *position* instead, which is what dragging snaps, so a node dropped afterwards does not
 * jump. Nodes drawn alike have the same offset between the two, so both hold at once.
 */
function planAxis(ctx, nodes, axis) {
  const tol = tolerance(ctx);
  const positionOf = function (node) {
    return axis === 'x' ? node.x : node.y;
  };
  const settle = function (node, delta) {
    if (!ctx.grid.snap) return delta;
    const pos = positionOf(node) + delta;
    return ctx.snapToGrid(pos) - positionOf(node);
  };

  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);

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
        const delta = settle(byId.get(member.id), target - member.value);
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
    if (found) deltas.set(node.id, found.delta);
    else if (ctx.grid.snap) deltas.set(node.id, ctx.snapToGrid(positionOf(node)) - positionOf(node));
  }
  return deltas;
}

function applyDeltas(ctx, nodes, dxs, dys) {
  let moved = 0;
  for (const node of nodes) {
    const dx = dxs.get(node.id) || 0;
    const dy = dys.get(node.id) || 0;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;
    ctx.moveBy(node.id, dx, dy);
    moved += 1;
  }
  return moved;
}

function autoAlign(ctx) {
  const nodes = workingSet(ctx);
  if (nodes.length < 2) {
    ctx.notify('Nothing to align — draw a couple of things first.', 'Align');
    return;
  }
  const moved = applyDeltas(ctx, nodes, planAxis(ctx, nodes, 'x'), planAxis(ctx, nodes, 'y'));
  if (moved === 0) ctx.notify('Everything is already aligned.', 'Align');
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
  let moved = 0;
  for (const node of nodes) {
    const dx = ctx.snapToGrid(node.x) - node.x;
    const dy = ctx.snapToGrid(node.y) - node.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;
    ctx.moveBy(node.id, dx, dy);
    moved += 1;
  }
  if (moved === 0) ctx.notify('Everything is already on the grid.', 'Align');
}

const twoSelected = function (ctx) {
  return ctx.selected().filter(movable).length >= 2;
};
const threeSelected = function (ctx) {
  return ctx.selected().filter(movable).length >= 3;
};

definePlugin({
  id: 'align',
  title: 'Align',
  description: 'Tidy up positions across the whole drawing.',
  commands: [
    {
      id: 'align.auto',
      label: 'Align',
      hint: 'Line up whatever is nearly lined up already — the selection, or the whole sheet',
      icon: 'align',
      run: autoAlign,
      items: [
        {
          id: 'align.left',
          label: 'Align left edges',
          icon: 'align-left',
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
