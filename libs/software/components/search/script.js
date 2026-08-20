// Search index: the shared chassis, drawn with the 'search' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'search');
  },
});
