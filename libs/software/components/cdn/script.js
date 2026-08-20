// CDN: the shared chassis, drawn with the 'globe' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'globe');
  },
});
