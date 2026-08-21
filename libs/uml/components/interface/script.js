var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: 'interface',
      name: ctx.params.name,
      italic: true,
      compartments: [{ lines: classifier.lines(ctx.params.operations) }],
    });
  },
});
