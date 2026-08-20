// Queue: the shared chassis, drawn with the 'layers' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'layers');
  },
});
