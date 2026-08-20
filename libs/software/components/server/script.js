// Server: the shared chassis, drawn with the 'server' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'server');
  },
});
