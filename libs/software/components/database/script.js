// Database: the shared chassis, drawn with the 'database' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'database');
  },
});
