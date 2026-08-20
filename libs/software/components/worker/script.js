// Worker: the shared chassis, drawn with the 'cog' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'cog');
  },
});
