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
      // Half-extents of the text, with the breathing room the old plate used to give it.
      var halfW = ink.width / 2 + 4;
      var halfH = ink.height / 2 + 2;
      var total = geometry.polylineLength(drawn);
      labelAt = labelSpot(drawn, total, halfW * 2);
      var box = { x: labelAt.x - halfW, y: labelAt.y - halfH, w: halfW * 2, h: halfH * 2 };
      // The gap is the run of the line that is actually behind the words, measured rather
      // than estimated from the direction at the middle: a route that turns a corner under
      // its own label is inside the box twice over, and an estimate cuts only one of them.
      var span = insideSpan(drawn, box);
      // On a run too short to lose the whole gap, keep a stub either side so it still reads
      // as a connector rather than as two arrowheads with a word between them.
      var keep = Math.min(4, total / 4);
      if (span) {
        var lo = Math.max(span.lo, keep);
        var hi = Math.min(span.hi, total - keep);
        if (hi - lo > 0.5) {
          parts = [
            geometry.trimPolyline(drawn, 0, total - lo),
            geometry.trimPolyline(drawn, hi, 0),
          ];
        }
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

/*
 * Where to write the caption.
 *
 * The middle of the route is the obvious answer and the wrong one: a route bends, and the
 * middle is as likely as not to be the bend itself, which leaves the words draped over a
 * corner with line sticking out on both sides. So the caption goes on a straight run — the
 * one nearest the middle that is long enough to hold it, sliding along that run to stay as
 * close to the middle as it can. If nothing is long enough, the middle it is.
 */
function labelSpot(points, total, need) {
  var best = null;
  var at = 0;
  for (var i = 1; i < points.length; i += 1) {
    var a = points[i - 1];
    var b = points[i];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= need) {
      var pos = Math.min(Math.max(total / 2, at + need / 2), at + len - need / 2);
      var score = Math.abs(pos - total / 2);
      if (!best || score < best.score) best = { score: score, at: pos };
    }
    at += len;
  }
  return geometry.pointAtLength(points, best ? best.at : total / 2);
}

/** The stretch of the polyline, in arc length, that lies inside `box`. */
function insideSpan(points, box) {
  var lo = Infinity;
  var hi = -Infinity;
  var at = 0;
  for (var i = 1; i < points.length; i += 1) {
    var a = points[i - 1];
    var b = points[i];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    var span = segmentInBox(a, b, box);
    if (span) {
      lo = Math.min(lo, at + span[0] * len);
      hi = Math.max(hi, at + span[1] * len);
    }
    at += len;
  }
  return hi > lo ? { lo: lo, hi: hi } : null;
}

/** Slab clip: the parametric interval of `a`->`b` inside the box, or null. */
function segmentInBox(a, b, box) {
  var t0 = 0;
  var t1 = 1;
  var d = [-(b.x - a.x), b.x - a.x, -(b.y - a.y), b.y - a.y];
  var q = [a.x - box.x, box.x + box.w - a.x, a.y - box.y, box.y + box.h - a.y];
  for (var i = 0; i < 4; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    var t = q[i] / d[i];
    if (d[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [t0, t1];
}
