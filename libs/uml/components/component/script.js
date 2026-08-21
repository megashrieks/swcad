var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: 'component',
      name: ctx.params.name,
      badge: 'component',
      compartments: [{ lines: classifier.lines(ctx.params.parts), hideEmpty: true }],
    });
  },
});
