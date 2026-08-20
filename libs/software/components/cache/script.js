// Cache: the shared chassis, drawn with the 'zap' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'zap');
  },
});
