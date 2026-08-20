// Event bus: the shared chassis, drawn with the 'radio-tower' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'radio-tower');
  },
});
