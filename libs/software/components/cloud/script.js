// Cloud: the shared chassis, drawn with the 'cloud' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'cloud');
  },
});
