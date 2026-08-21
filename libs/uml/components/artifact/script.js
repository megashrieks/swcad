var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      keyword: 'artifact',
      name: ctx.params.name,
      badge: 'artifact',
      compartments: [{ lines: classifier.lines(ctx.params.contents), hideEmpty: true }],
    });
  },
});
