// Shared style helper used by several base components.
defineComponent({
  applyFill: function (params) {
    return {
      fill: params.fill || 'var(--sw-surface)',
      stroke: params.stroke || 'var(--sw-ink)',
    };
  },
});
