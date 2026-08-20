/*
 * Flow field.
 *
 * A smooth noise field is read as a direction at every point:
 *
 *   angle(x, y) = fbm(x, y) * turns * 2pi
 *
 * Drop a particle anywhere and step it along that direction over and over, and it traces
 * a streamline. Because the field is continuous, particles that start near each other
 * follow near-identical paths and bunch into ropes, and where the field folds back on
 * itself they fan apart - which is the whole look of the thing.
 *
 * The starts are a jittered grid rather than pure noise, so the frame is covered evenly
 * without the clumps and bald patches that uniform random points always produce.
 */

var random = require('lib:random');

var TAU = Math.PI * 2;

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var lines = Math.max(1, Math.round(Number(p.lines) || 260));
    var steps = Math.max(2, Math.round(Number(p.steps) || 70));
    var stepLen = Math.max(0.2, p.stepLength === undefined ? 5 : Number(p.stepLength));
    var scale = Math.max(0.1, p.scale === undefined ? 2.6 : Number(p.scale));
    var turns = Math.max(0.1, p.turns === undefined ? 2 : Number(p.turns));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var colorful = p.colorful === true;
    var rand = random.rng(seed);

    // Jittered grid of seeds: as close to a square arrangement as `lines` allows.
    var cols = Math.max(1, Math.round(Math.sqrt((lines * w) / h)));
    var rows = Math.max(1, Math.ceil(lines / cols));
    var cellW = w / cols;
    var cellH = h / rows;

    var angleAt = function (x, y) {
      return random.fbm((x / w) * scale, (y / h) * scale, seed, 4) * turns * TAU;
    };

    var children = [];
    var placed = 0;
    for (var gy = 0; gy < rows && placed < lines; gy += 1) {
      for (var gx = 0; gx < cols && placed < lines; gx += 1) {
        var x = (gx + rand()) * cellW;
        var y = (gy + rand()) * cellH;
        var d = 'M' + random.r2(x) + ' ' + random.r2(y);
        var drawn = 0;
        var lastAngle = 0;
        for (var s = 0; s < steps; s += 1) {
          lastAngle = angleAt(x, y);
          x += Math.cos(lastAngle) * stepLen;
          y += Math.sin(lastAngle) * stepLen;
          // Streamlines are allowed to leave; they just stop, which keeps the edges soft
          // instead of piling every trace up against the border.
          if (x < 0 || y < 0 || x > w || y > h) break;
          d += 'L' + random.r2(x) + ' ' + random.r2(y);
          drawn += 1;
        }
        placed += 1;
        if (drawn < 2) continue;
        children.push(
          svg.path({
            id: 't' + placed,
            d: d,
            fill: 'none',
            stroke: colorful ? random.ramp((((lastAngle / TAU) % 1) + 1) % 1) : p.stroke || 'var(--sw-ink)',
            'stroke-width': Math.max(0.1, p.strokeWidth === undefined ? 0.9 : Number(p.strokeWidth)),
            'stroke-opacity': p.opacity === undefined ? 0.55 : Number(p.opacity),
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        );
      }
    }
    return svg.g({}, children);
  },
});
