/*
 * Truchet tiles.
 *
 * Sébastien Truchet's observation from 1704: take one asymmetric tile, place copies of it
 * on a grid at a random rotation each time, and patterns emerge that nobody designed. The
 * quarter-arc tile is the famous one - each arc meets its neighbours' arcs exactly at the
 * cell midpoints whichever way either tile is turned, so the arcs always connect, and the
 * curves wander into loops far larger than any tile.
 *
 * Each arc is a quarter circle of radius s/2 centred on a corner of the cell, drawn as a
 * single elliptical-arc command. The two orientations put the centres on opposite
 * diagonals.
 */

var random = require('lib:random');

/** The two quarter arcs of a cell, for orientation 0 or 1. */
function arcs(x, y, s, flip) {
  var m = s / 2;
  if (!flip) {
    // Centres at the top-left and bottom-right corners.
    return [
      'M' + (x + m) + ' ' + y + 'A' + m + ' ' + m + ' 0 0 1 ' + x + ' ' + (y + m),
      'M' + (x + m) + ' ' + (y + s) + 'A' + m + ' ' + m + ' 0 0 1 ' + (x + s) + ' ' + (y + m),
    ];
  }
  // Centres at the top-right and bottom-left corners.
  return [
    'M' + (x + m) + ' ' + y + 'A' + m + ' ' + m + ' 0 0 0 ' + (x + s) + ' ' + (y + m),
    'M' + x + ' ' + (y + m) + 'A' + m + ' ' + m + ' 0 0 1 ' + (x + m) + ' ' + (y + s),
  ];
}

/** A half-cell triangle, in one of four rotations. */
function triangle(x, y, s, turn) {
  var corners = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  var a = corners[turn % 4];
  var b = corners[(turn + 1) % 4];
  var c = corners[(turn + 2) % 4];
  return 'M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1] + 'L' + c[0] + ' ' + c[1] + 'Z';
}

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var cols = Math.max(1, Math.round(Number(p.cols) || 10));
    var rows = Math.max(1, Math.round(Number(p.rows) || 10));
    var variant = p.variant || 'arcs';
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    // Square cells, centred: a rotated tile only reads as rotated if the cell is square.
    var s = Math.min(w / cols, h / rows);
    var ox = (w - s * cols) / 2;
    var oy = (h - s * rows) / 2;
    var rand = random.rng(seed);
    var stroke = p.stroke || 'var(--sw-ink)';
    var width = Math.max(0.1, p.strokeWidth === undefined ? 3 : Number(p.strokeWidth));
    var colorful = p.colorful === true;

    var children = [];
    for (var r = 0; r < rows; r += 1) {
      for (var c = 0; c < cols; c += 1) {
        var x = random.r2(ox + c * s);
        var y = random.r2(oy + r * s);
        var cell = random.r2(s);
        var id = 't' + r + '_' + c;
        var ink = colorful ? random.ramp(rand()) : stroke;
        if (variant === 'triangles') {
          children.push(svg.path({ id: id, d: triangle(x, y, cell, Math.floor(rand() * 4)), fill: ink, stroke: 'none' }));
        } else if (variant === 'diagonals') {
          var down = rand() < 0.5;
          children.push(
            svg.line({
              id: id,
              x1: down ? x : x + cell,
              y1: y,
              x2: down ? x + cell : x,
              y2: y + cell,
              stroke: ink,
              'stroke-width': width,
              'stroke-linecap': 'round',
            }),
          );
        } else {
          var pair = arcs(x, y, cell, rand() < 0.5);
          children.push(
            svg.path({
              id: id,
              d: pair[0] + pair[1],
              fill: 'none',
              stroke: ink,
              'stroke-width': width,
              'stroke-linecap': 'round',
            }),
          );
        }
      }
    }
    return svg.g({}, children);
  },
});
