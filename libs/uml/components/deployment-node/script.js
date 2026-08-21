var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: ctx.params.stereotype,
      name: ctx.params.name,
      variant: 'node',
      compartments: [{ lines: classifier.lines(ctx.params.contents), hideEmpty: true }],
    });
  },
});
