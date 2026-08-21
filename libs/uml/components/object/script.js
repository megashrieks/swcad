var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      name: classifier.instanceName(ctx.params.name, ctx.params.classifier),
      underline: true,
      compartments: [{ lines: classifier.lines(ctx.params.slots) }],
    });
  },
});
