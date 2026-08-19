// Box: honours the fill, stroke and corner-radius params for the body slot.
defineComponent({
  style(ctx) {
    var p = ctx.params;
    return {
      slots: {
        body: { fill: p.fill || '#ffffff', stroke: p.stroke || '#2e3440', rx: String(p.radius === undefined ? 4 : p.radius) },
      },
    };
  },
});
