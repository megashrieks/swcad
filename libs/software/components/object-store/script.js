// Object store: the shared chassis, drawn with the 'archive' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'archive');
  },
});
