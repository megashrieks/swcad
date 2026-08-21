var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: 'dataType',
      name: ctx.params.name,
      compartments: [{ lines: classifier.lines(ctx.params.attributes) }],
    });
  },
});
