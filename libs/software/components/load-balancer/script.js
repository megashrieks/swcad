// Load balancer: the shared chassis, drawn with the 'network' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'network');
  },
});
