/*
 * Phyllotaxis - Vogel's model of a sunflower head.
 *
 *   theta = i * divergence,  r = k * sqrt(i)
 *
 * The square root is what keeps the packing even: area grows linearly with the index, so
 * every floret gets the same amount of room. The divergence angle is the interesting
 * knob. At the golden angle (137.507 degrees) no two florets ever share a ray, so the
 * head fills without gaps and the eye invents spiral arms out of near neighbours. Move it
 * by half a degree and the arms collapse into visible spokes.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var count = Math.max(1, Math.round(Number(p.count) || 600));
    var divergence = ((p.angle === undefined ? 137.507 : Number(p.angle)) * Math.PI) / 180;
    var dot = Math.max(0.2, p.dotSize === undefined ? 5 : Number(p.dotSize));
    var grow = Math.max(0, p.grow === undefined ? 0.65 : Number(p.grow));
    var pad = Math.max(0, Number(p.padding) || 0);
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var cx = w / 2;
    var cy = h / 2;
    var coloring = p.coloring || 'spiral';
    var fill = p.fill || 'var(--sw-ink)';

    // Scale so the outermost floret, dot and all, just touches the shorter edge.
    var span = Math.max(1, Math.min(w, h) / 2 - pad - dot);
    var k = span / Math.sqrt(Math.max(1, count - 1));

    var children = [];
    for (var i = 0; i < count; i += 1) {
      var t = count > 1 ? i / (count - 1) : 1;
      var r = k * Math.sqrt(i);
      var a = i * divergence;
      // `spiral` cycles the palette floret by floret. Consecutive florets are a whole turn
      // apart, so each colour lands on its own parastichy and the arms the eye was already
      // finding get painted in - far more striking than the concentric bands `ring` gives.
      var tone =
        coloring === 'plain'
          ? fill
          : coloring === 'ring'
            ? random.ramp(t)
            : random.RAMP[i % random.RAMP.length];
      children.push(
        svg.circle({
          id: 'f' + i,
          cx: random.r2(cx + r * Math.cos(a)),
          cy: random.r2(cy + r * Math.sin(a)),
          r: random.r2(dot * (1 - grow + grow * Math.sqrt(t))),
          fill: tone,
        }),
      );
    }
    return svg.g({}, children);
  },
});
