// Auth: the shared chassis, drawn with the 'shield-check' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'shield-check');
  },
});
