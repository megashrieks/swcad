/*
 * Contours, by marching squares.
 *
 * A noise field is sampled onto a lattice, then for each height the algorithm walks every
 * cell and asks a single question: which of my four corners are above this level? The
 * answer is a four-bit number, and each of the sixteen answers names a fixed set of cell
 * edges the contour must cross. Where it crosses is found by linear interpolation between
 * the two corner heights, which is what makes the lines smooth rather than blocky.
 *
 * The segments are emitted unjoined - a contour is drawn, not walked - so a level is one
 * path of many two-point subpaths. That is enough for a picture and avoids the loop
 * stitching that a real contour tracer needs.
 *
 * Cases 5 and 10 are the saddles, where two opposite corners are above the level and the
 * cell is genuinely ambiguous. Both are resolved the same way every time, so the map is
 * consistent even if it is not unique.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var levels = Math.max(1, Math.round(Number(p.levels) || 12));
    var nx = Math.max(2, Math.round(Number(p.resolution) || 60));
    var scale = Math.max(0.1, p.scale === undefined ? 2.4 : Number(p.scale));
    var octaves = Math.max(1, Math.round(Number(p.octaves) || 4));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var ny = Math.max(2, Math.round((nx * h) / w));
    var dx = w / nx;
    var dy = h / ny;
    var colorful = p.colorful === true;

    var field = [];
    var lo = Infinity;
    var hi = -Infinity;
    for (var j = 0; j <= ny; j += 1) {
      for (var i = 0; i <= nx; i += 1) {
        var v = random.fbm((i / nx) * scale, (j / ny) * scale, seed, octaves);
        field.push(v);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // Stretch the field to fill [0, 1]. Octaves of value noise pile up around the middle,
    // so without this the outer levels fall outside the terrain and draw nothing at all.
    var span = hi - lo;
    if (span > 1e-9) {
      for (var n = 0; n < field.length; n += 1) field[n] = (field[n] - lo) / span;
    }
    var at = function (i, j) {
      return field[j * (nx + 1) + i];
    };

    var children = [];
    for (var k = 0; k < levels; k += 1) {
      var level = (k + 1) / (levels + 1);
      var d = '';
      for (var cy = 0; cy < ny; cy += 1) {
        for (var cx = 0; cx < nx; cx += 1) {
          var tl = at(cx, cy);
          var tr = at(cx + 1, cy);
          var br = at(cx + 1, cy + 1);
          var bl = at(cx, cy + 1);
          var code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
          if (code === 0 || code === 15) continue;

          var x0 = cx * dx;
          var y0 = cy * dy;
          var mix = function (a, b) {
            var span = b - a;
            return Math.abs(span) < 1e-9 ? 0.5 : (level - a) / span;
          };
          var top = [x0 + mix(tl, tr) * dx, y0];
          var right = [x0 + dx, y0 + mix(tr, br) * dy];
          var bottom = [x0 + mix(bl, br) * dx, y0 + dy];
          var left = [x0, y0 + mix(tl, bl) * dy];

          var segs;
          if (code === 1 || code === 14) segs = [[left, bottom]];
          else if (code === 2 || code === 13) segs = [[bottom, right]];
          else if (code === 3 || code === 12) segs = [[left, right]];
          else if (code === 4 || code === 11) segs = [[top, right]];
          else if (code === 6 || code === 9) segs = [[top, bottom]];
          else if (code === 7 || code === 8) segs = [[left, top]];
          else if (code === 5) segs = [[left, top], [bottom, right]];
          else segs = [[left, bottom], [top, right]];

          for (var s = 0; s < segs.length; s += 1) {
            d +=
              'M' + random.r2(segs[s][0][0]) + ' ' + random.r2(segs[s][0][1]) +
              'L' + random.r2(segs[s][1][0]) + ' ' + random.r2(segs[s][1][1]);
          }
        }
      }
      if (d === '') continue;
      children.push(
        svg.path({
          id: 'level' + k,
          d: d,
          fill: 'none',
          stroke: colorful ? random.ramp(k / levels) : p.stroke || 'var(--sw-ink)',
          'stroke-width': Math.max(0.1, p.strokeWidth === undefined ? 1 : Number(p.strokeWidth)),
          'stroke-linecap': 'round',
        }),
      );
    }
    return svg.g({}, children);
  },
});
