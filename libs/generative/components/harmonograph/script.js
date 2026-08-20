/*
 * Harmonograph.
 *
 * Two pendulums swing under the pen and two more swing the paper, so each axis is the
 * sum of a pair of decaying sines:
 *
 *   x(t) = A sin(f1 t + p1) e^-(d t) + A sin(f2 t + p2) e^-(d t)
 *
 * If the four frequencies were exact integer ratios the trace would close after one
 * cycle and every later pass would land on top of the first. `detune` puts them very
 * slightly out of tune, which is what makes the figure precess: each pass is rotated a
 * fraction from the last, and the decay shrinks it, so the whole envelope spirals in.
 */

var random = require('lib:random');

var TAU = Math.PI * 2;

/** Four near-integer frequencies and their phases, drawn from the seed. */
function tuning(seed, detune) {
  var rand = random.rng(seed);
  var out = [];
  for (var i = 0; i < 4; i += 1) {
    var base = 1 + Math.floor(rand() * 5);
    out.push({
      f: base + (rand() * 2 - 1) * detune,
      phase: rand() * TAU,
      amp: 0.55 + rand() * 0.45,
      decay: 0.6 + rand() * 0.8,
    });
  }
  return out;
}

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var cycles = Math.max(1, Number(p.cycles) || 32);
    var samples = Math.max(32, Math.round(Number(p.samples) || 3000));
    var damping = Math.max(0, p.damping === undefined ? 0.006 : Number(p.damping));
    var detune = Math.max(0, p.detune === undefined ? 0.02 : Number(p.detune));
    var pad = Math.max(0, Number(p.padding) || 0);
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);

    var t4 = tuning(seed, detune);
    var span = cycles * TAU;
    var xs = [];
    var ys = [];
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < samples; i += 1) {
      var t = (i / (samples - 1)) * span;
      var x =
        t4[0].amp * Math.sin(t4[0].f * t + t4[0].phase) * Math.exp(-damping * t4[0].decay * t) +
        t4[1].amp * Math.sin(t4[1].f * t + t4[1].phase) * Math.exp(-damping * t4[1].decay * t);
      var y =
        t4[2].amp * Math.sin(t4[2].f * t + t4[2].phase) * Math.exp(-damping * t4[2].decay * t) +
        t4[3].amp * Math.sin(t4[3].f * t + t4[3].phase) * Math.exp(-damping * t4[3].decay * t);
      xs.push(x);
      ys.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Fit the trace to the frame after the fact: the amplitudes depend on the seed, so
    // there is no useful scale to guess up front.
    var sx = maxX - minX > 1e-6 ? (w - 2 * pad) / (maxX - minX) : 1;
    var sy = maxY - minY > 1e-6 ? (h - 2 * pad) / (maxY - minY) : 1;
    var d = '';
    for (var j = 0; j < samples; j += 1) {
      var px = random.r2(pad + (xs[j] - minX) * sx);
      var py = random.r2(pad + (ys[j] - minY) * sy);
      d += (j === 0 ? 'M' : 'L') + px + ' ' + py;
    }

    return svg.g({}, [
      svg.path({
        id: 'trace',
        d: d,
        fill: 'none',
        stroke: p.stroke || 'var(--sw-accent)',
        'stroke-width': Math.max(0.1, p.strokeWidth === undefined ? 0.8 : Number(p.strokeWidth)),
        'stroke-opacity': p.opacity === undefined ? 0.8 : Number(p.opacity),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ]);
  },
});
