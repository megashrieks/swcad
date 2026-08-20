/*
 * 10 PRINT CHR$(205.5+RND(1)); : GOTO 10
 *
 * The Commodore 64 had two diagonal characters at PETSCII codes 205 and 206. Adding a
 * random fraction to 205.5 and letting the cast to integer round it picks one or the
 * other, and printing them end to end wraps the screen into a grid. The diagonals meet at
 * the cell corners, so the strokes chain into corridors that look designed.
 *
 * `bias` is the coin. At 0 or 1 every cell leans the same way and the picture is a plain
 * hatch; the interest is all in the middle.
 */

var random = require('lib:random');

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var cols = Math.max(1, Math.round(Number(p.cols) || 24));
    var rows = Math.max(1, Math.round(Number(p.rows) || 16));
    var bias = p.bias === undefined ? 0.5 : Number(p.bias);
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var cw = w / cols;
    var ch = h / rows;
    var rand = random.rng(seed);
    var stroke = p.stroke || 'var(--sw-ink)';
    var width = Math.max(0.1, p.strokeWidth === undefined ? 2.5 : Number(p.strokeWidth));
    var colorful = p.colorful === true;

    var children = [];
    for (var r = 0; r < rows; r += 1) {
      for (var c = 0; c < cols; c += 1) {
        var roll = rand();
        var down = roll < bias;
        var x = c * cw;
        var y = r * ch;
        children.push(
          svg.line({
            id: 'c' + r + '_' + c,
            x1: random.r2(down ? x : x + cw),
            y1: random.r2(y),
            x2: random.r2(down ? x + cw : x),
            y2: random.r2(y + ch),
            stroke: colorful ? random.ramp(roll) : stroke,
            'stroke-width': width,
            'stroke-linecap': 'round',
          }),
        );
      }
    }
    return svg.g({}, children);
  },
});
