// Mobile app: the shared chassis, drawn with the 'smartphone' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'smartphone');
  },
});
