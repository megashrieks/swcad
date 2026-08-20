/*
 * Circle packing, the greedy way.
 *
 * Pick a point. Work out the largest circle that could sit there without touching the
 * frame or anything already placed - that is just the distance to the nearest boundary,
 * minus the gap. If it clears the minimum radius, keep it; otherwise throw the point
 * away and try again.
 *
 * No relaxation, no physics, no iteration to convergence. The whole character of the
 * picture comes from the ordering: the first circles land in open space and take whatever
 * they want, and every later one is squeezed into what is left, so the sizes fall into a
 * natural range without anything having to prescribe one.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var attempts = Math.max(1, Math.round(Number(p.attempts) || 900));
    var minR = Math.max(0.2, p.minRadius === undefined ? 3 : Number(p.minRadius));
    var maxR = Math.max(minR, p.maxRadius === undefined ? 52 : Number(p.maxRadius));
    var gap = Math.max(0, p.gap === undefined ? 2 : Number(p.gap));
    var round = p.shape === 'circle';
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var rand = random.rng(seed);

    var boundR = Math.min(w, h) / 2;
    var bx = w / 2;
    var by = h / 2;

    var placed = [];
    for (var a = 0; a < attempts; a += 1) {
      var x = rand() * w;
      var y = rand() * h;
      // Room to the frame first: cheap, and it rejects most of the doomed candidates.
      var room = round
        ? boundR - Math.sqrt((x - bx) * (x - bx) + (y - by) * (y - by))
        : Math.min(x, y, w - x, h - y);
      if (room - gap < minR) continue;
      for (var i = 0; i < placed.length && room - gap >= minR; i += 1) {
        var dx = x - placed[i][0];
        var dy = y - placed[i][1];
        var free = Math.sqrt(dx * dx + dy * dy) - placed[i][2];
        if (free < room) room = free;
      }
      var r = Math.min(maxR, room - gap);
      if (r >= minR) placed.push([x, y, r]);
    }

    var children = [];
    for (var k = 0; k < placed.length; k += 1) {
      var c = placed[k];
      children.push(
        svg.circle({
          id: 'c' + k,
          cx: random.r2(c[0]),
          cy: random.r2(c[1]),
          r: random.r2(c[2]),
          fill: p.colorful ? random.ramp((c[2] - minR) / Math.max(1e-6, maxR - minR)) : p.fill || 'none',
          stroke: p.stroke || 'var(--sw-ink)',
          'stroke-width': Math.max(0, p.strokeWidth === undefined ? 1.2 : Number(p.strokeWidth)),
        }),
      );
    }
    return svg.g({}, children);
  },
});
