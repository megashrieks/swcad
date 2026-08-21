var shapes = require('lib:shapes');

defineComponent({
  render: function (ctx) {
    return shapes.lifeline(ctx);
  },
});
