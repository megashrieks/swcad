/*
 * Mondrian, by recursive subdivision.
 *
 * One rectangle goes in. It is cut along its longer axis - always the longer one, which
 * is what keeps the pieces from degenerating into slivers - at a point somewhere around
 * the middle, and each half goes back in. Recursion stops at the depth limit or when a
 * piece is too small to cut in two, and the leaves are the composition.
 *
 * The result is a rectangular subdivision with no T-junctions: every rule runs edge to
 * edge of the piece it divides, which is what makes it read as a De Stijl painting rather
 * than as a random pile of boxes.
 *
 * `colors` takes a comma separated list; leave it blank for the theme's chart palette.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var depth = Math.max(0, Math.round(p.depth === undefined ? 5 : Number(p.depth)));
    var minSize = Math.max(1, p.minSize === undefined ? 40 : Number(p.minSize));
    var density = p.density === undefined ? 0.32 : Number(p.density);
    var bias = Math.max(0, p.bias === undefined ? 0.32 : Number(p.bias));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var rand = random.rng(seed);
    var colors = random.palette(p.colors);
    var paper = p.paper || 'var(--sw-paper)';
    var rule = p.stroke || 'var(--sw-ink)';
    var ruleWidth = Math.max(0, p.strokeWidth === undefined ? 5 : Number(p.strokeWidth));

    var leaves = [];
    var split = function (x, y, bw, bh, level) {
      var canX = bw >= minSize * 2;
      var canY = bh >= minSize * 2;
      if (level <= 0 || (!canX && !canY)) {
        leaves.push([x, y, bw, bh]);
        return;
      }
      // Cut across the longer axis, unless that axis has no room left.
      var vertical = canX && (!canY || bw >= bh);
      var t = 0.5 + (rand() * 2 - 1) * bias;
      if (vertical) {
        var cut = Math.max(minSize, Math.min(bw - minSize, bw * t));
        split(x, y, cut, bh, level - 1);
        split(x + cut, y, bw - cut, bh, level - 1);
      } else {
        var cutY = Math.max(minSize, Math.min(bh - minSize, bh * t));
        split(x, y, bw, cutY, level - 1);
        split(x, y + cutY, bw, bh - cutY, level - 1);
      }
    };
    split(0, 0, w, h, depth);

    var children = [];
    for (var i = 0; i < leaves.length; i += 1) {
      var box = leaves[i];
      var colored = rand() < density;
      children.push(
        svg.rect({
          id: 'p' + i,
          x: random.r2(box[0]),
          y: random.r2(box[1]),
          width: random.r2(box[2]),
          height: random.r2(box[3]),
          fill: colored ? colors[Math.floor(rand() * colors.length)] : paper,
          stroke: rule,
          'stroke-width': ruleWidth,
        }),
      );
    }
    return svg.g({}, children);
  },
});
