/*
 * Strange attractors.
 *
 * There is no randomness here at all. A single point is pushed through the same pair of
 * equations tens of thousands of times; it never settles on a cycle and never runs away,
 * so the orbit gradually fills a fixed set - the attractor - and the picture is just that
 * set, plotted. Nudging `a` by a hundredth is a different figure entirely.
 *
 * The three maps below all live inside roughly [-2, 2] on both axes, which is why they
 * can share one auto-fit step.
 */

var random = require('lib:random');

function step(variant, x, y, a, b, c, d) {
  if (variant === 'clifford') {
    return [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)];
  }
  if (variant === 'svensson') {
    return [d * Math.sin(a * x) - Math.sin(b * y), c * Math.cos(a * x) + Math.cos(b * y)];
  }
  return [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y)];
}

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var variant = p.variant || 'dejong';
    var a = p.a === undefined ? -2 : Number(p.a);
    var b = p.b === undefined ? -2.34 : Number(p.b);
    var c = p.c === undefined ? -1.2 : Number(p.c);
    var d = p.d === undefined ? 2 : Number(p.d);
    var count = Math.max(100, Math.round(Number(p.points) || 20000));
    var pad = Math.max(0, Number(p.padding) || 0);
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);

    var x = 0.1;
    var y = 0.1;
    // Discard the approach: the first few hundred iterations are still on their way in
    // from the starting point and are not part of the attractor.
    for (var warm = 0; warm < 200; warm += 1) {
      var s0 = step(variant, x, y, a, b, c, d);
      x = s0[0];
      y = s0[1];
    }

    var xs = [];
    var ys = [];
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < count; i += 1) {
      var s = step(variant, x, y, a, b, c, d);
      x = s[0];
      y = s[1];
      if (!isFinite(x) || !isFinite(y)) break;
      xs.push(x);
      ys.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (xs.length === 0) return svg.g({}, []);

    var sx = maxX - minX > 1e-6 ? (w - 2 * pad) / (maxX - minX) : 1;
    var sy = maxY - minY > 1e-6 ? (h - 2 * pad) / (maxY - minY) : 1;

    // Every point is a zero-length subpath drawn with a round cap, so the whole cloud is
    // one element instead of tens of thousands of circles.
    var dot = Math.max(0.05, p.dotSize === undefined ? 0.6 : Number(p.dotSize));
    var path = '';
    for (var j = 0; j < xs.length; j += 1) {
      path += 'M' + random.r2(pad + (xs[j] - minX) * sx) + ' ' + random.r2(pad + (ys[j] - minY) * sy) + 'h0';
    }

    return svg.g({}, [
      svg.path({
        id: 'orbit',
        d: path,
        fill: 'none',
        stroke: p.stroke || 'var(--sw-ink)',
        'stroke-width': dot,
        'stroke-opacity': p.opacity === undefined ? 0.35 : Number(p.opacity),
        'stroke-linecap': 'round',
      }),
    ]);
  },
});
