/*
 * Hilbert curve.
 *
 * The curve is defined by its index, not by a rule applied to a picture: cell d of a
 * 2^order grid maps to a coordinate through a fixed sequence of rotations and
 * reflections, so the whole figure is a loop from 0 to 4^order with no recursion and no
 * stored geometry. Bumping the order by one quadruples the point count and keeps every
 * earlier turn exactly where it was, nested into a quarter of the frame.
 */

var random = require('lib:random');

/**
 * Hilbert index -> grid coordinate (Lam & Shapiro's iterative conversion).
 *
 * The loop walks the quadtree from the smallest square outwards. At each level `rx`/`ry`
 * say which quadrant the index falls in, and the two quadrants along the diagonal are
 * entered through a reflected copy of the curve - which is what the swap and the
 * `s - 1 - x` mirror below undo, so the partial coordinate stays in the parent's frame.
 */
function d2xy(n, d) {
  var t = d;
  var x = 0;
  var y = 0;
  for (var s = 1; s < n; s *= 2) {
    var rx = 1 & Math.floor(t / 2);
    var ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      var swap = x;
      x = y;
      y = swap;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var order = Math.max(1, Math.round(Number(p.order) || 5));
    var n = Math.pow(2, order);
    var total = n * n;
    var pad = Math.max(0, Number(p.padding) || 0);
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var stepX = (w - 2 * pad) / n;
    var stepY = (h - 2 * pad) / n;
    var width = Math.max(0.1, p.strokeWidth === undefined ? 2 : Number(p.strokeWidth));
    var color = p.stroke || 'var(--sw-ink)';
    var colorful = p.colorful === true;

    // One path per colour band, each band starting on the previous band's last point so
    // the joins are seamless. Without colour the whole curve is a single path.
    var bands = colorful ? random.RAMP.length : 1;
    var children = [];
    var d = '';
    var band = 0;
    var last = null;
    for (var i = 0; i < total; i += 1) {
      var cell = d2xy(n, i);
      var x = random.r2(pad + (cell[0] + 0.5) * stepX);
      var y = random.r2(pad + (cell[1] + 0.5) * stepY);
      if (d === '') d = 'M' + x + ' ' + y;
      else d += 'L' + x + ' ' + y;
      last = [x, y];
      var nextBand = Math.min(bands - 1, Math.floor(((i + 1) / total) * bands));
      if (nextBand !== band || i === total - 1) {
        children.push(
          svg.path({
            id: 'curve' + band,
            d: d,
            fill: 'none',
            stroke: colorful ? random.RAMP[band % random.RAMP.length] : color,
            'stroke-width': width,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        );
        band = nextBand;
        d = 'M' + last[0] + ' ' + last[1];
      }
    }
    return svg.g({}, children);
  },
});
