/*
 * The frame every component in this library shares.
 *
 * A software architecture symbol is an icon with a label under it, so rather than
 * author twenty near-identical shapes, each component is a one-line script that
 * hands this module an icon name.
 *
 * There is no drawn body and no drawn ports. A rect hugging the content is the
 * hit area, kept invisible, and a circle around the icon is the connectable
 * perimeter, so the symbols sit on the sheet as marks rather than as cards - put
 * a base/box behind one if a container is wanted.
 *
 * It is drawn from a script rather than from a static `shape.svg` for one reason:
 * static geometry is stretched by the engine on resize, with the x and y scales
 * applied separately. That is right for a plain box and wrong for a pictogram -
 * a wide node would smear the icon sideways. Drawing to `ctx.size` instead lets
 * the glyph keep its 1:1 aspect at any box size.
 *
 * Element ids match `annotations.json`, which is how the port, the hit area and
 * the editable title are attached to scripted output.
 */

var icons = require('lib:icons');

var FONT = 'Inter, Segoe UI, sans-serif';

function pick(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function numOr(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

function r2(v) {
  return Math.round(v * 100) / 100;
}

defineComponent({
  render: function (ctx, iconName) {
    var w = Math.max(1, ctx.size.w);
    var h = Math.max(1, ctx.size.h);
    var p = ctx.params;

    var accent = pick(p.accent, 'var(--sw-accent)');
    var titleSize = Math.max(6, numOr(p.fontSize, 13));
    var title = String(pick(p.title, ''));
    var subtitle = String(pick(p.subtitle, ''));
    var showIcon = p.showIcon === undefined ? true : Boolean(p.showIcon);
    var iconStroke = Math.max(0.2, numOr(p.iconStroke, 1.8));

    var subSize = Math.max(7, titleSize - 3);
    var pad = 6;
    var gap = 7;
    var titleH = title ? titleSize * 1.15 : 0;
    var subH = subtitle ? subSize * 1.3 : 0;
    var textH = titleH + subH;

    // The glyph takes whichever axis runs out first, so it stays square: a wide
    // node gets a big icon, and one squashed flat drops it rather than smear it.
    // It is not capped at the authored 64: these are vector outlines, so scaling
    // past 1:1 costs nothing, and a cap would make the resize grip look broken -
    // dragging the box out would add padding and leave the symbol the same size.
    var room = Math.min(w - pad * 2, h - pad * 2 - textH - (textH > 0 ? gap : 0));
    var glyph = showIcon ? Math.max(0, room) : 0;
    if (!(glyph >= 12)) glyph = 0;

    var contentH = glyph + (glyph > 0 && textH > 0 ? gap : 0) + textH;

    // The engine measures `<text>` as a zero-width point, so the label would not
    // contribute to the box at all. Estimate it from the character count instead
    // - it only has to be close enough for a grab region.
    var textW = 0;
    if (title) textW = Math.max(textW, title.length * titleSize * 0.56);
    if (subtitle) textW = Math.max(textW, subtitle.length * subSize * 0.56);
    var contentW = Math.max(glyph, textW);

    // The hit box hugs the drawn content rather than the whole instance box, so
    // selecting, grabbing and routing all treat the symbol as the size it looks.
    //
    // It hangs from the node's origin rather than sitting centred in the instance
    // box. Centring looked tidier but meant that growing the box on an axis the
    // glyph could not use slid the whole symbol sideways - dragging the resize
    // grip past the point where it stops having an effect would walk the
    // component across the sheet instead of doing nothing.
    var boxW = Math.min(w, contentW + pad * 2);
    var boxH = Math.min(h, contentH + pad * 2);
    var boxX = 0;
    var boxY = 0;
    var mid = boxX + boxW / 2;
    var top = boxY + (boxH - contentH) / 2;

    // No body: these are symbols on the sheet, not cards. The rect is only a hit
    // area, kept invisible, so the content can still be grabbed anywhere inside
    // it and the router sees one obstacle instead of weaving between strokes.
    var children = [
      svg.rect({
        id: 'body',
        x: r2(boxX),
        y: r2(boxY),
        width: r2(boxW),
        height: r2(boxH),
        fill: 'none',
        stroke: 'none',
      }),
    ];

    if (glyph > 0) {
      var scale = glyph / icons.size;
      var subpaths = icons.paths[iconName] || [];
      // The transform scales the stroke along with the outline, so the authored
      // width is divided back out to keep one constant weight at every size.
      var strokeAt = Math.round((iconStroke / scale) * 1e3) / 1e3;
      var marks = [];
      for (var s = 0; s < subpaths.length; s += 1) {
        marks.push(
          svg.path({
            d: subpaths[s],
            fill: 'none',
            stroke: accent,
            'stroke-width': strokeAt,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        );
      }
      children.push(
        svg.g(
          {
            id: 'icon',
            transform:
              'translate(' + r2(mid - glyph / 2) + ' ' + r2(top) + ') scale(' + Math.round(scale * 1e4) / 1e4 + ')',
          },
          marks,
        ),
      );
    }

    var textTop = top + glyph + (glyph > 0 && textH > 0 ? gap : 0);
    if (title) {
      children.push(
        svg.text(title, {
          id: 'title',
          x: r2(mid),
          y: r2(textTop + titleSize * 0.86),
          'text-anchor': 'middle',
          'font-family': FONT,
          'font-size': titleSize,
          'font-weight': '500',
          fill: pick(p.ink, 'var(--sw-ink)'),
        }),
      );
    }
    if (subtitle) {
      children.push(
        svg.text(subtitle, {
          id: 'subtitle',
          x: r2(mid),
          y: r2(textTop + titleH + subSize * 0.95),
          'text-anchor': 'middle',
          'font-family': FONT,
          'font-size': subSize,
          fill: 'var(--sw-ink-muted)',
        }),
      );
    }

    // One port encircling the symbol rather than four dots: a connector lands
    // wherever it meets the circle, so there is nothing to aim at and nothing to
    // draw. The editor draws the ring itself while the connect tool is armed,
    // which is why this is transparent.
    //
    // The ring belongs to the icon, not to the label: sizing it to the whole
    // content let a long title blow it out sideways, which pushed the attach
    // points a long way from the thing they were pointing at. It is the circle
    // inscribed in the glyph box plus a small margin - a circumscribed ring
    // hangs a fifth of the glyph below the icon, which at these sizes is far
    // enough into the caption for an arrow to land on the words, while the bare
    // inscribed one runs right along the icon's own outline on a small symbol.
    // The margin is a flat few units rather than a fraction of the glyph, so it
    // reads the same at every size. A label-only symbol has no glyph to hug, so
    // it falls back to the content box.
    var ringPad = 5;
    var ringR = glyph > 0 ? glyph / 2 + ringPad : Math.sqrt(boxW * boxW + boxH * boxH) / 2;
    var ringY = glyph > 0 ? top + glyph / 2 : boxY + boxH / 2;
    children.push(
      svg.circle({
        id: 'edge',
        cx: r2(mid),
        cy: r2(ringY),
        r: r2(ringR),
        fill: 'none',
        stroke: 'transparent',
      }),
    );

    // The resize grip. The editor draws the square itself for a selected node, so this only
    // has to say where: the bottom-right of the hit box. That corner tracks the pointer 1:1
    // on a diagonal drag, which the connect ring's does not - the ring is a function of the
    // glyph, so it grows by half a diagonal per side and runs ahead of the cursor. It is a
    // zero-radius point, so saying so adds nothing to the bounds.
    children.push(
      svg.circle({
        id: 'grip',
        cx: r2(boxX + boxW),
        cy: r2(boxY + boxH),
        r: 0,
        fill: 'none',
        stroke: 'none',
      }),
    );

    return svg.g({}, children);
  },
});
