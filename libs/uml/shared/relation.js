/*
 * The relationship connectors.
 *
 * Every line in a UML diagram is the same line. What distinguishes an association from a
 * generalization from a dependency is only what sits at the ends and whether the stroke is
 * broken: a hollow triangle means "is a", a hollow diamond means "has a", the same diamond
 * filled in means "owns a", and a dashed stroke means the relationship is a dependency
 * rather than a structural one. So there is one connector here, and each component in the
 * palette is that connector with its ends and its stroke already set - which is what makes
 * them tell-apart-able on the sheet and interchangeable in the inspector.
 *
 * `route` has to be handed in. A shared module is compiled with the drawing and geometry
 * helpers but not with the router, which belongs to the component being routed.
 */

var t = require('lib:theme');

/** How far along the line an end decoration reaches, per unit of head size. */
var DEPTH = {
  triangle: 1.0,
  diamond: 1.7,
  'filled-diamond': 1.7,
  filled: 1.0,
  open: 0,
  none: 0,
  ball: 0,
  socket: 0,
};

/**
 * How much of the line an end decoration actually covers, per unit of head size.
 *
 * Not the same thing as `DEPTH`, which says where the *stroke* has to stop: an open arrow
 * head is two strokes the line runs right into, so it trims nothing while still sitting on
 * the last stretch of the line. A label has to clear the ink, so it measures with this.
 */
var REACH = {
  triangle: 1.0,
  diamond: 1.7,
  'filled-diamond': 1.7,
  filled: 1.0,
  open: 1.0,
  ball: 0.9,
  socket: 0.7,
  cross: 0.6,
  none: 0,
};

function unit(from, to) {
  var dx = to.x - from.x;
  var dy = to.y - from.y;
  var len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function pointsAttr(points) {
  var out = [];
  for (var i = 0; i < points.length; i += 1) out.push(t.r2(points[i].x) + ',' + t.r2(points[i].y));
  return out.join(' ');
}

/**
 * One end decoration, drawn at `tip` and pointing the way the line arrived.
 *
 * The hollow shapes are filled with the sheet colour rather than left unfilled, because a
 * hollow triangle sitting on top of the box it points at has to hide the border behind it
 * or it reads as a triangle with a line through it.
 */
function head(kind, tip, prev, size, stroke, lineW) {
  if (!kind || kind === 'none') return [];
  var u = unit(prev, tip);
  var n = { x: -u.y, y: u.x };
  var at = function (back, side) {
    return { x: tip.x - u.x * back + n.x * side, y: tip.y - u.y * back + n.y * side };
  };

  if (kind === 'open') {
    var w = size * 0.72;
    return [
      svg.path({
        d:
          'M ' + t.r2(at(size, w).x) + ' ' + t.r2(at(size, w).y) +
          ' L ' + t.r2(tip.x) + ' ' + t.r2(tip.y) +
          ' L ' + t.r2(at(size, -w).x) + ' ' + t.r2(at(size, -w).y),
        fill: 'none',
        stroke: stroke,
        'stroke-width': lineW,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ];
  }
  if (kind === 'cross') {
    var d = size * 0.5;
    return [
      svg.path({
        d:
          'M ' + t.r2(at(d, d).x) + ' ' + t.r2(at(d, d).y) + ' L ' + t.r2(at(-d, -d).x) + ' ' + t.r2(at(-d, -d).y) +
          ' M ' + t.r2(at(d, -d).x) + ' ' + t.r2(at(d, -d).y) + ' L ' + t.r2(at(-d, d).x) + ' ' + t.r2(at(-d, d).y),
        fill: 'none',
        stroke: stroke,
        'stroke-width': lineW * 1.4,
        'stroke-linecap': 'round',
      }),
    ];
  }
  if (kind === 'ball') {
    var r = size * 0.42;
    var c = at(r, 0);
    return [
      svg.circle({
        cx: t.r2(c.x),
        cy: t.r2(c.y),
        r: t.r2(r),
        fill: 'var(--sw-paper)',
        stroke: stroke,
        'stroke-width': lineW,
      }),
    ];
  }
  if (kind === 'socket') {
    var rr = size * 0.62;
    var c2 = at(0, 0);
    var a = { x: c2.x + n.x * rr, y: c2.y + n.y * rr };
    var b = { x: c2.x - n.x * rr, y: c2.y - n.y * rr };
    return [
      svg.path({
        d:
          'M ' + t.r2(a.x) + ' ' + t.r2(a.y) +
          ' A ' + t.r2(rr) + ' ' + t.r2(rr) + ' 0 0 0 ' + t.r2(b.x) + ' ' + t.r2(b.y),
        fill: 'none',
        stroke: stroke,
        'stroke-width': lineW,
      }),
    ];
  }
  if (kind === 'diamond' || kind === 'filled-diamond') {
    var dl = size * DEPTH.diamond;
    var dw = size * 0.48;
    return [
      svg.polygon({
        points: pointsAttr([tip, at(dl / 2, dw), at(dl, 0), at(dl / 2, -dw)]),
        fill: kind === 'diamond' ? 'var(--sw-paper)' : stroke,
        stroke: stroke,
        'stroke-width': lineW,
        'stroke-linejoin': 'round',
      }),
    ];
  }
  // triangle / filled
  var tl = size;
  var tw = size * 0.55;
  return [
    svg.polygon({
      points: pointsAttr([tip, at(tl, tw), at(tl, -tw)]),
      fill: kind === 'filled' ? stroke : 'var(--sw-paper)',
      stroke: stroke,
      'stroke-width': kind === 'filled' ? 0 : lineW,
      'stroke-linejoin': 'round',
    }),
  ];
}

/**
 * Where to write a label that belongs to the line as a whole.
 *
 * The straight run nearest the middle, so the words never straddle a corner. Unlike the
 * base arrow's caption this one sits beside the stroke rather than cutting it: UML puts an
 * association name next to the line, and leaving the line whole means a reader can follow
 * it past every label on it.
 */
function midSpot(points, need) {
  var total = geometry.polylineLength(points);
  var best = null;
  var at = 0;
  for (var i = 1; i < points.length; i += 1) {
    var a = points[i - 1];
    var b = points[i];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= need) {
      var pos = Math.min(Math.max(total / 2, at + need / 2), at + len - need / 2);
      var score = Math.abs(pos - total / 2);
      if (!best || score < best.score) best = { score: score, at: pos, i: i };
    }
    at += len;
  }
  var where = best ? best.at : total / 2;
  var idx = best ? best.i : Math.max(1, Math.floor(points.length / 2));
  var pt = geometry.pointAtLength(points, where);
  var dir = unit(points[idx - 1], points[idx]);
  return { pos: pt, dir: dir };
}

/** A run of text set clear of the stroke, on the side `side` (+1 one way, -1 the other). */
function beside(value, pos, dir, side, gap, size, stroke) {
  if (!value) return null;
  var n = { x: -dir.y, y: dir.x };
  var vertical = Math.abs(dir.y) > Math.abs(dir.x);
  // Which way the text is pushed off the stroke. `side` alone does not say: it is read
  // against the direction the line is travelling, and the two ends of a connector travel
  // opposite ways, so the same `side` lands above the line at one end and below it at the
  // other. What the layout needs to know is the sign of the displacement itself.
  var ox = n.x * side;
  var oy = n.y * side;
  var x;
  var y;
  if (vertical) {
    // Along a vertical run the text hangs off to one side and its baseline is level with
    // the anchor.
    x = pos.x + ox * (gap + 2);
    y = pos.y + oy * (gap + 2) + size * 0.33;
  } else {
    // Along a horizontal one it sits above or below; text under the line starts at its
    // baseline and has to be pushed down by its own cap height to clear the stroke.
    var off = gap + (oy < 0 ? 0 : size * 0.8);
    x = pos.x + ox * off;
    y = pos.y + oy * off;
  }
  return svg.text(String(value), {
    x: t.r2(x),
    y: t.r2(y),
    'text-anchor': vertical ? (ox > 0 ? 'start' : 'end') : 'middle',
    'font-family': t.FONT,
    'font-size': size,
    fill: stroke,
  });
}

/**
 * Draw a relationship.
 *
 * `spec` fixes what the component *is* - its ends and its stroke pattern - while the
 * parameters decide how it is routed and what is written on it.
 */
function render(ctx, route, spec) {
  var p = ctx.params;
  var a = ctx.connection.from;
  var b = ctx.connection.to;
  var stroke = t.pick(p.stroke, 'var(--sw-ink)');
  var lineW = Math.max(0.2, t.numOr(p.strokeWidth, 1.4));
  var style = t.pick(p.style, 'orthogonal');
  var size = 9 + lineW * 1.5;

  var startKind = t.pick(p.startEnd, spec.startEnd || 'none');
  var endKind = t.pick(p.endEnd, spec.endEnd || 'none');
  var dashed = t.bool(p.dashed, !!spec.dashed);

  var opts = {
    fromFacing: a.facing,
    toFacing: b.facing,
    waypoints: ctx.connection.waypoints,
    obstacles: p.avoid === false ? [] : ctx.obstacles,
    stub: t.numOr(p.stub, 18),
    clearance: t.numOr(p.clearance, 10),
    router: t.pick(p.router, 'auto'),
    bendPenalty: t.numOr(p.bendPenalty, 0),
  };

  var pts;
  if (style === 'straight') pts = route.straight(a.pos, b.pos, opts);
  else if (style === 'curve') {
    pts = route.curve(a.pos, b.pos, {
      fromFacing: a.facing,
      toFacing: b.facing,
      waypoints: ctx.connection.waypoints,
      stub: p.stub,
    });
  } else pts = route.orthogonal(a.pos, b.pos, opts);

  if (pts.length < 2) pts = [a.pos, b.pos];

  // A closed head is a solid shape sitting on the end of the line, so the stroke stops at
  // its base. An open one is two strokes of the same weight and wants the line to reach it.
  var drawn = geometry.trimPolyline(
    pts,
    (DEPTH[startKind] || 0) * size,
    (DEPTH[endKind] || 0) * size,
  );

  var d =
    style === 'curve'
      ? geometry.smoothPath(drawn)
      : geometry.polylinePath(drawn, t.numOr(p.radius, 6));

  var children = [
    svg.path({
      d: d,
      fill: 'none',
      stroke: stroke,
      'stroke-width': lineW,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': dashed ? '7 5' : null,
      'data-swcad-route': JSON.stringify(pts),
    }),
  ];

  var startMarks = head(startKind, pts[0], pts[1], size, stroke, lineW);
  var endMarks = head(endKind, pts[pts.length - 1], pts[pts.length - 2], size, stroke, lineW);
  for (var i = 0; i < startMarks.length; i += 1) children.push(startMarks[i]);
  for (var j = 0; j < endMarks.length; j += 1) children.push(endMarks[j]);

  // ------------------------------------------------------------- the words

  var labelSize = Math.max(5, t.numOr(p.labelSize, 9));
  var name = String(t.pick(p.label, ''));
  var keyword = t.guillemets(p.stereotype);
  var heading = keyword && name ? keyword + ' ' + name : keyword || name;
  if (heading) {
    var need = t.widthOf(heading, labelSize, {}) + 6;
    var spot = midSpot(pts, need);
    children.push(beside(heading, spot.pos, spot.dir, -1, 4, labelSize, stroke));
  }

  // Multiplicity and role sit at the ends, on opposite sides of the line, which is how a
  // reader tells `0..*` (how many) from `owner` (what it is called) without either being
  // labelled.
  var ends = [
    { at: pts[0], toward: pts[1], kind: startKind, mult: p.sourceMultiplicity, role: p.sourceRole },
    { at: pts[pts.length - 1], toward: pts[pts.length - 2], kind: endKind, mult: p.targetMultiplicity, role: p.targetRole },
  ];
  for (var e = 0; e < ends.length; e += 1) {
    var end = ends[e];
    if (!end.at || !end.toward) continue;
    if (!end.mult && !end.role) continue;
    var away = unit(end.at, end.toward);
    // The way the line *travels* here, which at the source is `away` and at the target is
    // back along it. Measuring both ends against the same direction is what keeps the
    // multiplicities on one side of the connector and the roles on the other, instead of
    // the pair swapping over at the far end.
    var along = e === 0 ? away : { x: -away.x, y: -away.y };
    // Set clear of the head. A centred label reaches back towards the tip by half its own
    // width, so that is part of the distance; along a vertical run it hangs off to the side
    // instead and only its cap height is in the way.
    var vertical = Math.abs(along.y) > Math.abs(along.x);
    var half = vertical
      ? labelSize * 0.5
      : Math.max(t.widthOf(String(end.mult || ''), labelSize, {}), t.widthOf(String(end.role || ''), labelSize, {})) / 2;
    var back = Math.max(size * (REACH[end.kind] || 0) + 4 + half, 14);
    var anchor = { x: end.at.x + away.x * back, y: end.at.y + away.y * back };
    children.push(beside(end.mult, anchor, along, -1, 3, labelSize, stroke));
    children.push(beside(end.role, anchor, along, 1, 3, labelSize, stroke));
  }

  return svg.g({}, children);
}

defineComponent({ render: render, head: head, midSpot: midSpot, beside: beside });
