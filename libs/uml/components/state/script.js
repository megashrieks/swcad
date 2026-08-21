var classifier = require('lib:classifier');

defineComponent({
  render: function (ctx) {
    return classifier.render(ctx, {
      name: ctx.params.name,
      variant: 'rounded',
      compartments: [{ lines: classifier.lines(ctx.params.activities), hideEmpty: true }],
    });
  },
});
