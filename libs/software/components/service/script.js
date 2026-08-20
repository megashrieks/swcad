// Service: the shared chassis, drawn with the 'box' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'box');
  },
});
