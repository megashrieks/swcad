/**
 * Export.
 *
 * The default action is the one that is nearly always wanted: the drawing as SVG, the
 * selection if there is one. The rest — raster at a couple of scales, print to PDF, and
 * exporting the whole sheet when only part of it is selected — live under the caret.
 */

function svgName(ctx) {
  return ctx.doc.name + '.svg';
}

function pngName(ctx) {
  return ctx.doc.name + '.png';
}

function hasSelection(ctx) {
  return ctx.selection.length > 0;
}

definePlugin({
  id: 'export',
  title: 'Export',
  description: 'Draw the sheet out as SVG, PNG or PDF.',
  commands: [
    {
      id: 'export.svg',
      label: 'Export',
      hint: 'Export as SVG — the selection if something is selected',
      icon: 'download',
      run: function (ctx) {
        ctx.download(svgName(ctx), ctx.svg());
      },
      items: [
        {
          id: 'export.svg.all',
          label: 'SVG — whole drawing',
          icon: 'code',
          run: function (ctx) {
            ctx.download(svgName(ctx), ctx.svg({ selection: false }));
          },
        },
        {
          id: 'export.svg.selection',
          label: 'SVG — selection only',
          icon: 'code',
          enabled: hasSelection,
          run: function (ctx) {
            ctx.download(svgName(ctx), ctx.svg({ selection: true }));
          },
        },
        {
          id: 'export.png.2x',
          label: 'PNG at 2×',
          icon: 'image',
          separator: true,
          run: function (ctx) {
            return ctx.downloadPng(pngName(ctx), ctx.svg(), 2);
          },
        },
        {
          id: 'export.png.4x',
          label: 'PNG at 4×',
          hint: 'For print or a large screen',
          icon: 'image',
          run: function (ctx) {
            return ctx.downloadPng(pngName(ctx), ctx.svg(), 4);
          },
        },
        {
          id: 'export.pdf',
          label: 'Print / PDF',
          hint: 'Opens the print dialogue on the whole drawing',
          icon: 'document',
          separator: true,
          run: function (ctx) {
            ctx.print(ctx.svg({ selection: false }), ctx.doc.title || ctx.doc.name);
          },
        },
      ],
    },
  ],
});
