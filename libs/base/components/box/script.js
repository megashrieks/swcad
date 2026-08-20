// Box: honours the fill, stroke and corner-radius params for the body slot.
defineComponent({
  style(ctx) {
    var p = ctx.params;
    return {
      slots: {
        body: { fill: p.fill || 'var(--sw-surface)', stroke: p.stroke || 'var(--sw-ink)', rx: String(p.radius === undefined ? 4 : p.radius) },
      },
    };
  },
});
