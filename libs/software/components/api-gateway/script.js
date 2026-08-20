// API gateway: the shared chassis, drawn with the 'waypoints' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'waypoints');
  },
});
