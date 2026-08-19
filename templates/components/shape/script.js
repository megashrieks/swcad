// Behaviour for {{name}}. Delete this file if the shape needs no code.
//
// Hooks: render(ctx) returns SVG (or null to keep shape.svg), style(ctx) restyles
// annotated elements, ports(ctx) adds ports at runtime.
defineComponent({
  style: function (ctx) {
    var p = ctx.params;
    return {
      slots: {
        body: { fill: p.fill || '#ffffff', stroke: p.stroke || '#2e3440' },
      },
    };
  },
});
