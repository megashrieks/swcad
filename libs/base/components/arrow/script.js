// Arrow connector.
//
// This is the reference example of a graph-aware component: it reads its two
// endpoints, asks the engine for the obstacles near the route, picks a path and
// returns the SVG for it. The `data-swcad-route` attribute hands the computed
// polyline back to the editor for hit-testing and waypoint editing.
defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var a = ctx.connection.from;
    var b = ctx.connection.to;
    var style = p.style || 'orthogonal';

    var opts = {
      fromFacing: a.facing,
      toFacing: b.facing,
      waypoints: ctx.connection.waypoints,
      obstacles: p.avoid === false ? [] : ctx.obstacles,
      stub: p.stub || 18,
      clearance: p.clearance || 10,
      router: p.router || 'auto',
      bendPenalty: p.bendPenalty === undefined ? 0 : p.bendPenalty,
    };

    var pts;
    if (style === 'straight') pts = route.straight(a.pos, b.pos, opts);
    else if (style === 'curve') {
      // A curve leaves each port along its normal and the length of that lead-in is what
      // shapes it. The orthogonal stub is a clearance, far too short here: on a long run it
      // makes the first span a stub of a few units against a span of hundreds, and the
      // smoothing overshoots into a hook. Let the curve pick a lead-in from the span unless
      // one was asked for.
      pts = route.curve(a.pos, b.pos, {
        fromFacing: a.facing,
        toFacing: b.facing,
        waypoints: ctx.connection.waypoints,
        stub: p.stub,
      });
    } else pts = route.orthogonal(a.pos, b.pos, opts);

    var stroke = p.stroke || 'var(--sw-ink)';
    var width = p.strokeWidth || 1.6;
    var headSize = 9 + width;
    var endHead = p.arrow !== false && pts.length > 1;
    var startHead = !!p.startArrow && pts.length > 1;

    // The stroke stops at each arrowhead's base. Drawn all the way to the tip its round cap
    // would stick half a stroke width past the point, which reads as the line overshooting
    // the head. `pts` stays untrimmed: that is the route the editor hit-tests and edits.
    var drawn =
      startHead || endHead
        ? geometry.trimPolyline(
            pts,
            startHead ? route.arrowHeadDepth(headSize) : 0,
            endHead ? route.arrowHeadDepth(headSize) : 0,
          )
        : pts;

    var label = p.label === undefined || p.label === null ? '' : String(p.label);
    var labelSize = 11;
    var labelAt = null;
    // The label is not written on a plate over the line — the line steps aside for it. The
    // stroke is cut where the text sits, so the words read against the sheet itself and the
    // connector keeps whatever is behind it visible.
    var parts = [drawn];
    if (label) {
      var font = { size: labelSize, family: 'Inter, Segoe UI, sans-serif' };
      var ink = text.measure(label, font);
      var total = geometry.polylineLength(drawn);
      var midLen = total / 2;
      labelAt = geometry.pointAtLength(drawn, midLen);
      // Half-extents of the text, with the breathing room the old plate used to give it.
      var halfW = ink.width / 2 + 4;
      var halfH = ink.height / 2 + 2;
      var back = geometry.pointAtLength(drawn, Math.max(0, midLen - 2));
      var fwd = geometry.pointAtLength(drawn, Math.min(total, midLen + 2));
      var dx = fwd.x - back.x;
      var dy = fwd.y - back.y;
      var run = Math.hypot(dx, dy);
      // How far the gap reaches along the line: where the line leaves the text's box. A
      // horizontal run has to clear the whole width, a vertical one only the height.
      var reach = halfW;
      if (run > 1e-6) {
        dx /= run;
        dy /= run;
        reach = Math.min(
          Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity,
          Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity,
        );
      }
      // On a run too short to lose the whole gap, keep a stub either side so it still reads
      // as a connector rather than as two arrowheads with a word between them.
      var maxReach = midLen - 4;
      if (maxReach > 0) {
        reach = Math.min(reach, maxReach);
        parts = [
          geometry.trimPolyline(drawn, 0, total - (midLen - reach)),
          geometry.trimPolyline(drawn, midLen + reach, 0),
        ];
      }
    }

    // Both sides are subpaths of one `d`, so the connector stays a single element to
    // hit-test and the route handed back to the editor is still the whole route.
    var d = parts
      .map(function (part) {
        return style === 'curve'
          ? geometry.smoothPath(part)
          : geometry.polylinePath(part, p.radius === undefined ? 6 : p.radius);
      })
      .join(' ');

    var children = [
      svg.path({
        d: d,
        fill: 'none',
        stroke: stroke,
        'stroke-width': width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': p.dashed ? '6 4' : null,
        'data-swcad-route': JSON.stringify(pts),
      }),
    ];

    if (endHead) {
      children.push(
        svg.polygon({
          points: pointsAttr(route.arrowHead(pts[pts.length - 1], pts[pts.length - 2], headSize)),
          fill: stroke,
        }),
      );
    }
    if (startHead) {
      children.push(
        svg.polygon({ points: pointsAttr(route.arrowHead(pts[0], pts[1], headSize)), fill: stroke }),
      );
    }
    if (labelAt) {
      children.push(
        svg.text(label, {
          x: labelAt.x,
          y: labelAt.y + labelSize * 0.35,
          'text-anchor': 'middle',
          'font-size': labelSize,
          'font-family': 'Inter, Segoe UI, sans-serif',
          fill: stroke,
        }),
      );
    }

    return svg.g({}, children);
  },
});

function pointsAttr(points) {
  return points
    .map(function (pt) {
      return pt.x + ',' + pt.y;
    })
    .join(' ');
}
