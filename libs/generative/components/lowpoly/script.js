/*
 * Low poly.
 *
 * A regular lattice of points, each nudged off its spot by up to `jitter` of a cell, then
 * cut into two triangles per cell. That is deliberately not a Delaunay triangulation: a
 * jittered grid already gives well-shaped triangles with no long slivers, and it costs one
 * pass instead of an incremental mesh - the facets are what is wanted here, not the mesh.
 *
 * Points on the border are jittered only along the border, so the piece stays a clean
 * rectangle with no notches or overhangs at the edges.
 *
 * Shading is flat per facet, sampled from a noise field at the triangle's centroid, so
 * neighbouring facets land in the same colour band and the mesh reads as lit terrain
 * rather than as confetti.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var cols = Math.max(1, Math.round(Number(p.cols) || 12));
    var rows = Math.max(1, Math.round(Number(p.rows) || 9));
    var jitter = Math.max(0, p.jitter === undefined ? 0.4 : Number(p.jitter));
    var scale = Math.max(0.1, p.scale === undefined ? 1.8 : Number(p.scale));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var cw = w / cols;
    var ch = h / rows;
    var rand = random.rng(seed);
    var colors = random.palette(p.colors);
    // Blank means "stroke each facet in its own fill". Adjacent polygons antialias against
    // each other and leave hairline seams; a stroke of the same colour covers them without
    // adding a visible outline. Naming a colour draws real facet edges instead.
    var edge = typeof p.stroke === 'string' && p.stroke !== '' ? p.stroke : null;
    var edgeWidth = Math.max(0, p.strokeWidth === undefined ? 1 : Number(p.strokeWidth));

    var pts = [];
    for (var j = 0; j <= rows; j += 1) {
      for (var i = 0; i <= cols; i += 1) {
        var onLeft = i === 0;
        var onRight = i === cols;
        var onTop = j === 0;
        var onBottom = j === rows;
        var x = i * cw + (onLeft || onRight ? 0 : (rand() * 2 - 1) * jitter * cw);
        var y = j * ch + (onTop || onBottom ? 0 : (rand() * 2 - 1) * jitter * ch);
        pts.push([random.r2(x), random.r2(y)]);
      }
    }
    var at = function (i, j) {
      return pts[j * (cols + 1) + i];
    };

    var facet = function (id, a, b, c) {
      var mx = (a[0] + b[0] + c[0]) / 3;
      var my = (a[1] + b[1] + c[1]) / 3;
      var shade = random.fbm((mx / w) * scale, (my / h) * scale, seed, 3);
      var band = Math.min(colors.length - 1, Math.floor(shade * colors.length));
      var tone = colors[band];
      return svg.polygon({
        id: id,
        points: a[0] + ',' + a[1] + ' ' + b[0] + ',' + b[1] + ' ' + c[0] + ',' + c[1],
        fill: tone,
        stroke: edge === null ? tone : edge,
        'stroke-width': edgeWidth,
        'stroke-linejoin': 'round',
      });
    };

    var children = [];
    for (var r = 0; r < rows; r += 1) {
      for (var c = 0; c < cols; c += 1) {
        var tl = at(c, r);
        var tr = at(c + 1, r);
        var br = at(c + 1, r + 1);
        var bl = at(c, r + 1);
        // Flip the shared diagonal on a checkerboard so the mesh has no visible grain.
        if ((r + c) % 2 === 0) {
          children.push(facet('f' + r + '_' + c + 'a', tl, tr, br));
          children.push(facet('f' + r + '_' + c + 'b', tl, br, bl));
        } else {
          children.push(facet('f' + r + '_' + c + 'a', tl, tr, bl));
          children.push(facet('f' + r + '_' + c + 'b', tr, br, bl));
        }
      }
    }
    return svg.g({}, children);
  },
});
