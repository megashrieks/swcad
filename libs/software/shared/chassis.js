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
 * Because the drawing hugs its content, the instance box is not a size and these
 * components are not resizable: `iconSize` says how big the symbol is, and the
 * caption follows from `fontSize`.
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
    var iconSize = Math.max(0, numOr(p.iconSize, 0));

    var subSize = Math.max(7, titleSize - 3);
    var pad = 6;
    var gap = 7;
    var titleH = title ? titleSize * 1.15 : 0;
    var subH = subtitle ? subSize * 1.3 : 0;
    var textH = titleH + subH;

    // `iconSize` is how big the symbol is. These components are not resizable,
    // because the instance box was never the size of anything: the drawn box
    // hugs its content, so dragging it only fed this one number, and it fed it
    // badly - the room left for the glyph is what the caption did not take, so
    // two boxes dragged to the same size came out with different icons whenever
    // their labels were different lengths. Saying the number outright is the
    // whole point; it is not capped by the box, and it is not capped at the
    // authored size either, since these are vector outlines that cost nothing
    // to scale up.
    //
    // 0 means "take it from the instance box", which is how every sheet drawn
    // before the parameter existed is still measured.
    var room = Math.min(w - pad * 2, h - pad * 2 - textH - (textH > 0 ? gap : 0));
    var glyph = showIcon ? (iconSize > 0 ? iconSize : Math.max(0, room)) : 0;
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
    // A glyph sized by hand is not clipped back to the instance box - the number
    // is the promise, and honouring it only sometimes would put two symbols set
    // to the same size back to different sizes.
    var naturalW = contentW + pad * 2;
    var naturalH = contentH + pad * 2;
    var boxW = iconSize > 0 ? naturalW : Math.min(w, naturalW);
    var boxH = iconSize > 0 ? naturalH : Math.min(h, naturalH);

    // The symbol hangs from its port ring, not from a corner: the node's origin
    // is the centre of the ring, so everything else is placed around it.
    //
    // A corner origin puts the port at `origin + boxW / 2`, and half a hugged
    // box is whatever the caption made it - so a node dropped exactly on the
    // grid still had an off-grid port. On a snapped sheet a connector may only
    // travel along the lattice, and the lattice is only symmetric about a line
    // that lies on it, so two symbols placed as mirror images routed to
    // different lengths: their ports sat at the same offset from a grid line
    // instead of opposite ones. Hanging from the ring makes the port inherit
    // the node's own snap, which the editor already keeps on the grid, and it
    // makes equally spaced nodes have equally spaced ports whatever their
    // captions say.
    var innerTop = (boxH - contentH) / 2;
    var boxX = -boxW / 2;
    var boxY = glyph > 0 ? -(innerTop + glyph / 2) : -boxH / 2;
    var mid = boxX + boxW / 2;
    var top = boxY + innerTop;

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

    return svg.g({}, children);
  },
});
