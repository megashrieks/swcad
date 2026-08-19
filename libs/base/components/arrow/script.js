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
      bendPenalty: p.bendPenalty === undefined ? 25 : p.bendPenalty,
    };

    var pts;
    if (style === 'straight') pts = route.straight(a.pos, b.pos, opts);
    else if (style === 'curve') pts = route.curve(a.pos, b.pos, opts);
    else pts = route.orthogonal(a.pos, b.pos, opts);

    var d =
      style === 'curve'
        ? geometry.smoothPath(pts)
        : geometry.polylinePath(pts, p.radius === undefined ? 6 : p.radius);

    var stroke = p.stroke || '#3b4252';
    var width = p.strokeWidth || 1.6;

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

    if (p.arrow !== false && pts.length > 1) {
      children.push(
        svg.polygon({
          points: pointsAttr(route.arrowHead(pts[pts.length - 1], pts[pts.length - 2], 9 + width)),
          fill: stroke,
        }),
      );
    }
    if (p.startArrow) {
      children.push(
        svg.polygon({ points: pointsAttr(route.arrowHead(pts[0], pts[1], 9 + width)), fill: stroke }),
      );
    }
    if (p.label) {
      var mid = geometry.pointAtLength(pts, geometry.polylineLength(pts) / 2);
      children.push(
        svg.rect({
          x: mid.x - String(p.label).length * 3.4 - 4,
          y: mid.y - 9,
          width: String(p.label).length * 6.8 + 8,
          height: 16,
          rx: 3,
          fill: '#ffffff',
          'fill-opacity': 0.9,
        }),
      );
      children.push(
        svg.text(String(p.label), {
          x: mid.x,
          y: mid.y + 3,
          'text-anchor': 'middle',
          'font-size': 11,
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
