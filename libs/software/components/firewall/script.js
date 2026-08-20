// Firewall: the shared chassis, drawn with the 'brick-wall' glyph.
var chassis = require('lib:chassis');

defineComponent({
  render: function (ctx) {
    return chassis.render(ctx, 'brick-wall');
  },
});
