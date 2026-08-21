var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: 'enumeration',
      name: ctx.params.name,
      compartments: [{ lines: classifier.lines(ctx.params.literals) }],
    });
  },
});
