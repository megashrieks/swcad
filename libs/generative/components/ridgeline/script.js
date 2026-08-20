/*
 * Ridgeline / joyplot.
 *
 * Every ridge is a slice of the same 2D noise field taken at a different depth, so
 * neighbouring lines are related rather than independent - that is what makes the stack
 * read as one landscape instead of a pile of unrelated squiggles.
 *
 * The hidden-line removal is the trick worth knowing. There is no depth test in SVG, so
 * each ridge is drawn twice: once as an opaque shape closed all the way to the bottom of
 * the frame, which paints over everything behind it, and once as the open line on top.
 * Rows are emitted back to front, so each new ridge buries the tails of the ones behind.
 *
 * A gaussian envelope pins the peaks to the middle and flattens both ends, so the stack
 * has a clear horizon line down each side.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var lines = Math.max(1, Math.round(Number(p.lines) || 34));
    var samples = Math.max(2, Math.round(Number(p.samples) || 160));
    var amp = Math.max(0, p.amplitude === undefined ? 70 : Number(p.amplitude));
    var scale = Math.max(0.1, p.scale === undefined ? 4 : Number(p.scale));
    var spread = Math.max(0.02, p.spread === undefined ? 0.34 : Number(p.spread));
    var pad = Math.max(0, p.padding === undefined ? 12 : Number(p.padding));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var stroke = p.stroke || 'var(--sw-ink)';
    var fill = p.fill || 'var(--sw-paper)';
    var width = Math.max(0.1, p.strokeWidth === undefined ? 1.4 : Number(p.strokeWidth));

    var x0 = pad;
    var x1 = Math.max(pad + 1, w - pad);
    // Baselines start low enough that the tallest peak of the back row stays in frame.
    var top = Math.min(h - pad, pad + amp);
    var bottom = Math.max(top, h - pad);
    var children = [];

    // Sample first, then stretch the whole field to [0, 1]. Octaves of value noise cluster
    // hard around the middle, and unstretched the ridges come out as gentle swells rather
    // than the spikes the plot is known for.
    var signal = [];
    var lo = Infinity;
    var hi = -Infinity;
    for (var j = 0; j < lines; j += 1) {
      for (var i = 0; i < samples; i += 1) {
        var v = random.fbm((i / (samples - 1)) * scale, j * 0.7, seed, 5);
        signal.push(v);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    var range = hi - lo;
    if (range > 1e-9) {
      for (var n = 0; n < signal.length; n += 1) signal[n] = (signal[n] - lo) / range;
    }

    for (var row = 0; row < lines; row += 1) {
      var baseY = lines > 1 ? top + (row * (bottom - top)) / (lines - 1) : bottom;
      var pts = '';
      for (var s = 0; s < samples; s += 1) {
        var t = s / (samples - 1);
        var x = x0 + t * (x1 - x0);
        var env = Math.exp(-((t - 0.5) * (t - 0.5)) / (2 * spread * spread));
        var y = baseY - amp * env * signal[row * samples + s];
        pts += (s === 0 ? 'M' : 'L') + random.r2(x) + ' ' + random.r2(y);
      }
      children.push(
        svg.path({
          id: 'mask' + row,
          d: pts + 'L' + random.r2(x1) + ' ' + random.r2(h) + 'L' + random.r2(x0) + ' ' + random.r2(h) + 'Z',
          fill: fill,
          stroke: 'none',
        }),
      );
      children.push(
        svg.path({
          id: 'ridge' + row,
          d: pts,
          fill: 'none',
          stroke: stroke,
          'stroke-width': width,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }
    return svg.g({}, children);
  },
});
