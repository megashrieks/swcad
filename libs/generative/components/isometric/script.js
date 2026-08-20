/*
 * Isometric cube stacks.
 *
 * The projection is the usual 2:1 isometric: one grid step east moves the screen point
 * right by s*cos30 and down by s/2, one step south moves it left and down by the same,
 * and one cube of altitude moves it straight up by s.
 *
 * Each cube is drawn as an opaque hexagon - the silhouette of all three faces at once -
 * with two translucent shade overlays laid on its left and right faces. The obvious
 * alternative, three translucent faces, does not work: a cube behind shows straight
 * through them and the shading washes out into mush. Painting the body opaque first means
 * every overlay composites against one known colour, so the three faces read as lit, top
 * and shadow no matter what is stacked behind.
 *
 * There is no depth buffer in SVG, so the draw order is the depth test. Columns are
 * emitted in order of (i + j), which is exactly the screen-depth order for this
 * projection, and within a column from the ground up, so every cube is painted after
 * everything it can possibly hide.
 */

var random = require('lib:random');

var COS30 = Math.cos(Math.PI / 6);

defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var seed = Math.round(Number(p.seed) || 0);
    var cols = Math.max(1, Math.round(Number(p.cols) || 9));
    var rows = Math.max(1, Math.round(Number(p.rows) || 9));
    var maxH = Math.max(1, Math.round(Number(p.height) || 5));
    var scale = Math.max(0.1, p.scale === undefined ? 1.6 : Number(p.scale));
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var fill = p.fill || 'var(--sw-accent)';
    var shade = p.shade || 'var(--sw-ink)';
    var shading = Math.max(0, p.shading === undefined ? 1 : Number(p.shading));
    var edge = p.stroke || 'var(--sw-paper)';
    var edgeWidth = Math.max(0, p.strokeWidth === undefined ? 0.6 : Number(p.strokeWidth));
    var colorful = p.colorful === true;

    // Solve for the cube edge that makes the whole stack fit, then centre what is left.
    var s = Math.min(w / ((cols + rows) * COS30), h / (maxH + 1 + (cols + rows - 2) / 2));
    if (!(s > 0)) return svg.g({}, []);
    var half = s * COS30;
    var spanW = (cols + rows) * half;
    var spanH = s * (maxH + 1 + (cols + rows - 2) / 2);
    var ox = (w - spanW) / 2 + rows * half;
    var oy = (h - spanH) / 2 + (maxH - 1) * s + s / 2;

    var children = [];
    var order = [];
    for (var i = 0; i < cols; i += 1) {
      for (var j = 0; j < rows; j += 1) order.push([i, j]);
    }
    order.sort(function (a, b) {
      return a[0] + a[1] - (b[0] + b[1]);
    });

    var poly = function (id, points, faceFill, opacity) {
      var attrs = {
        id: id,
        points: points,
        fill: faceFill,
        stroke: edge,
        'stroke-width': edgeWidth,
        'stroke-linejoin': 'round',
      };
      if (opacity !== undefined) attrs['fill-opacity'] = opacity;
      return svg.polygon(attrs);
    };

    for (var n = 0; n < order.length; n += 1) {
      var gi = order[n][0];
      var gj = order[n][1];
      var noise = random.fbm((gi / cols) * scale, (gj / rows) * scale, seed, 3);
      var stack = Math.max(1, Math.round(noise * maxH));
      for (var k = 0; k < stack; k += 1) {
        var cx = random.r2(ox + (gi - gj) * half);
        var cy = random.r2(oy + (gi + gj) * (s / 2) - k * s);
        var top = random.r2(cy - s / 2);
        var mid = random.r2(cy + s / 2);
        var side = random.r2(cy + s);
        var foot = random.r2(cy + s / 2 + s);
        var left = random.r2(cx - half);
        var right = random.r2(cx + half);
        var tone = colorful ? random.ramp((k + 0.5) / maxH) : fill;
        var id = 'c' + gi + '_' + gj + '_' + k;
        // The silhouette: top rhombus plus both side faces, as one opaque shape.
        children.push(
          poly(
            id,
            cx + ',' + top + ' ' + right + ',' + cy + ' ' + right + ',' + side + ' ' +
              cx + ',' + foot + ' ' + left + ',' + side + ' ' + left + ',' + cy,
            tone,
          ),
        );
        children.push(
          poly(
            id + 'l',
            left + ',' + cy + ' ' + cx + ',' + mid + ' ' + cx + ',' + foot + ' ' + left + ',' + side,
            shade,
            random.r2(0.38 * shading),
          ),
        );
        children.push(
          poly(
            id + 'r',
            right + ',' + cy + ' ' + cx + ',' + mid + ' ' + cx + ',' + foot + ' ' + right + ',' + side,
            shade,
            random.r2(0.62 * shading),
          ),
        );
      }
    }
    return svg.g({}, children);
  },
});

