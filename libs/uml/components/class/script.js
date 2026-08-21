var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: ctx.params.stereotype,
      name: ctx.params.name,
      italic: Boolean(ctx.params.abstract),
      compartments: [
        { lines: classifier.lines(ctx.params.attributes) },
        { lines: classifier.lines(ctx.params.operations) },
      ],
    });
  },
});
