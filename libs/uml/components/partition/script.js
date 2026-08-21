var container = require('lib:container');

defineComponent({
  render: function (ctx) {
    return container.renderPartition(ctx);
  },
});
