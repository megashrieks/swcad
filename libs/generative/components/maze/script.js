/*
 * A maze that is not drawn, only described.
 *
 * Three numbers - columns, rows and a seed - are the whole component. The walls are
 * carved on every render, so a 40x25 maze costs a document exactly as much as an empty
 * one does, and changing the seed is a different maze rather than a different drawing.
 *
 * Carving is a recursive backtracker (depth-first with an explicit stack), which gives a
 * "perfect" maze: exactly one route between any two cells. That is what makes the entry
 * and the exit always reachable, and the solution unique.
 */

/**
 * Deterministic PRNG (mulberry32). `Math.random` is not in the sandbox and would be
 * wrong here anyway: the same seed has to give the same maze on every machine, forever.
 */
function rng(seed) {
  var a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Carve the maze.
 *
 * Walls live on the edges between cells, not in the cells, so they are held as two
 * grids: `v[c * rows + r]` is the wall down the left side of cell (c, r) - there are
 * cols + 1 of those columns - and `h[c * (rows + 1) + r]` is the wall across its top.
 * Both start solid and the walk knocks one down each time it steps into a new cell.
 */
function carve(cols, rows, seed) {
  var v = new Array((cols + 1) * rows).fill(true);
  var h = new Array(cols * (rows + 1)).fill(true);
  var seen = new Array(cols * rows).fill(false);
  var next = rng(seed);
  var stack = [0];
  var options = [];
  seen[0] = true;
  while (stack.length > 0) {
    var cur = stack[stack.length - 1];
    var c = cur % cols;
    var r = (cur - c) / cols;
    options.length = 0;
    if (c > 0 && !seen[cur - 1]) options.push(0);
    if (c < cols - 1 && !seen[cur + 1]) options.push(1);
    if (r > 0 && !seen[cur - cols]) options.push(2);
    if (r < rows - 1 && !seen[cur + cols]) options.push(3);
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    var dir = options[Math.floor(next() * options.length)];
    var to = cur;
    if (dir === 0) {
      v[c * rows + r] = false;
      to = cur - 1;
    } else if (dir === 1) {
      v[(c + 1) * rows + r] = false;
      to = cur + 1;
    } else if (dir === 2) {
      h[c * (rows + 1) + r] = false;
      to = cur - cols;
    } else {
      h[c * (rows + 1) + r + 1] = false;
      to = cur + cols;
    }
    seen[to] = true;
    stack.push(to);
  }
  // The way in and the way out: the west side of the first cell, the east side of the last.
  v[0] = false;
  v[cols * rows + rows - 1] = false;
  return { v: v, h: h };
}

/**
 * Wall runs, merged along their own axis.
 *
 * A straight corridor is one line, not one line per cell it passes. That matters twice
 * over: the drawing is a fraction of the size, and when the walls are placed on a sheet
 * as separate parts the connector router has a handful of rectangles to reason about
 * instead of hundreds.
 */
function runs(maze, cols, rows, cell) {
  var out = [];
  var start;
  var c;
  var r;
  for (c = 0; c <= cols; c += 1) {
    start = -1;
    for (r = 0; r <= rows; r += 1) {
      var down = r < rows && maze.v[c * rows + r];
      if (down && start < 0) start = r;
      else if (!down && start >= 0) {
        out.push({ x1: c * cell, y1: start * cell, x2: c * cell, y2: r * cell });
        start = -1;
      }
    }
  }
  for (r = 0; r <= rows; r += 1) {
    start = -1;
    for (c = 0; c <= cols; c += 1) {
      var across = c < cols && maze.h[c * (rows + 1) + r];
      if (across && start < 0) start = c;
      else if (!across && start >= 0) {
        out.push({ x1: start * cell, y1: r * cell, x2: c * cell, y2: r * cell });
        start = -1;
      }
    }
  }
  return out;
}

/** Parameters as the drawing needs them: whole cells, at least one. */
function shape(params) {
  var cols = Math.max(1, Math.round(Number(params.cols) || 1));
  var rows = Math.max(1, Math.round(Number(params.rows) || 1));
  var cell = Math.max(1, Number(params.cell) || 24);
  return { cols: cols, rows: rows, cell: cell };
}

defineComponent({
  /*
   * Every wall is its own element, and there is nothing else in the drawing.
   *
   * That is deliberate. A connector is routed around each of a component's drawn
   * primitives rather than around one box enclosing the lot, so a maze made of separate
   * walls has corridors a route can use. A background panel or a drawn-in solution line
   * would be handed over as an obstacle too, covering the whole figure and walling the
   * search out, so neither exists.
   *
   * Walls are rectangles rather than stroked lines because an obstacle needs an interior:
   * a stroked line's bounding box is flat on one axis, and only the stroke it is drawn
   * with gives it any thickness at all.
   */
  render: function (ctx) {
    var p = ctx.params;
    var s = shape(p);
    var maze = carve(s.cols, s.rows, Math.round(Number(p.seed) || 0));
    var segments = runs(maze, s.cols, s.rows, s.cell);
    var t = Math.max(0.5, p.strokeWidth === undefined ? 3 : Number(p.strokeWidth));
    var color = p.stroke || 'var(--sw-ink)';
    var children = [];
    for (var i = 0; i < segments.length; i += 1) {
      var g = segments[i];
      children.push(
        svg.rect({
          id: 'w' + i,
          x: g.x1 - t / 2,
          y: g.y1 - t / 2,
          width: g.x2 - g.x1 + t,
          height: g.y2 - g.y1 + t,
          fill: color,
        }),
      );
    }
    return svg.g({}, children);
  },
});

