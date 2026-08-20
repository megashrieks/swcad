// Web app: the shared chassis, drawn with the 'monitor' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'monitor');
  },
});
