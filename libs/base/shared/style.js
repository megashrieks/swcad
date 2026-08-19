// Shared style helper used by several base components.
defineComponent({
  applyFill: function (params) {
    return {
      fill: params.fill || '#ffffff',
      stroke: params.stroke || '#2e3440',
    };
  },
});
