var relation = require('lib:relation');

/*
 * What a message looks like follows from what it is, so the ends are not offered as
 * separate settings the way they are on a class relationship: a reply drawn with a filled
 * head would simply be wrong.
 */
var KIND = {
  sync: { endEnd: 'filled' },
  async: { endEnd: 'open' },
  reply: { endEnd: 'open', dashed: true },
  create: { endEnd: 'open', dashed: true },
  destroy: { endEnd: 'cross' },
};

defineComponent({
  render: function (ctx) {
    return relation.render(ctx, route, KIND[ctx.params.kind] || KIND.sync);
  },
});
