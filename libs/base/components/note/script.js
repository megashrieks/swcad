// Minimal style pass: routes the fill/stroke params into the `body` slot.
var style = require('lib:style');

defineComponent({
  style: function (ctx) {
    return { slots: { body: style.applyFill(ctx.params) } };
  },
});
