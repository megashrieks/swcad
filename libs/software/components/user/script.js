// User: the shared chassis, drawn with the 'users' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'users');
  },
});
