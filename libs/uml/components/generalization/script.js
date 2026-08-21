var relation = require('lib:relation');

defineComponent({
  render: function (ctx) {
    // `route` is a component-script global; a shared module is not given one, so the
    // router is handed across rather than reached for.
    return relation.render(ctx, route, {});
  },
});
