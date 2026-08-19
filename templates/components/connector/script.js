// {{name}}: a connector is drawn entirely by code, so there is no shape.svg.
//
// ctx.connection gives the two resolved endpoints and any waypoints the user dragged;
// ctx.obstacles lists the node bounds nearby. Returning the route in
// `data-swcad-route` lets the editor hit-test and edit the path.
defineComponent({
  render: function (ctx) {
    var p = ctx.params;
    var a = ctx.connection.from;
    var b = ctx.connection.to;

    var pts = route.orthogonal(a.pos, b.pos, {
      fromFacing: a.facing,
      toFacing: b.facing,
      waypoints: ctx.connection.waypoints,
      obstacles: p.avoid === false ? [] : ctx.obstacles,
    });

    return svg.path({
      d: geometry.polylinePath(pts, p.radius === undefined ? 6 : p.radius),
      fill: 'none',
      stroke: p.stroke || '#3b4252',
      'stroke-width': p.strokeWidth || 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': p.dashed ? '6 4' : null,
      'data-swcad-route': JSON.stringify(pts),
    });
  },
});
