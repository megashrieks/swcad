/*
 * The classifier box: a name over a stack of compartments.
 *
 * Almost every rectangle in UML is this one drawing with different words in it. A class
 * has attributes and operations; an interface is the same box with «interface» over the
 * name and no attributes; an enumeration lists literals; an object underlines its name
 * and lists slots; a state rounds its corners. Writing that once means the compartment
 * rules - how tall an empty one is, where the separators fall, how the box grows - are
 * the same wherever they appear, which is the whole point of a notation.
 *
 * The box is as big as the instance box or as big as its contents, whichever is bigger.
 * A classifier that clipped its own member list would be worse than useless, and one that
 * ignored the size you dragged it to would be irritating, so it honours both: drag it
 * larger and it stays larger, type past the bottom and it grows.
 */

var t = require('lib:theme');

var HEAD_PAD = 7;
var COMP_PAD = 6;
/** Depth of the third dimension on a deployment node. */
var NODE_DEPTH = 13;

/** The small mark in the top-right corner that says which kind of classifier this is. */
function badge(kind, x, y, size, stroke, width) {
  var s = size / 16;
  if (kind === 'component') {
    // The UML component icon: a rectangle with two tabs on its left edge.
    var bw = 14 * s;
    var bh = 11 * s;
    var tw = 5 * s;
    var th = 3 * s;
    var mark = function (dy) {
      return svg.rect({
        x: t.r2(x - tw / 2),
        y: t.r2(y + dy),
        width: t.r2(tw),
        height: t.r2(th),
        fill: 'var(--sw-paper)',
        stroke: stroke,
        'stroke-width': width,
      });
    };
    return svg.g({}, [
      svg.rect({
        x: t.r2(x),
        y: t.r2(y),
        width: t.r2(bw),
        height: t.r2(bh),
        fill: 'none',
        stroke: stroke,
        'stroke-width': width,
      }),
      mark(bh * 0.18),
      mark(bh * 0.58),
    ]);
  }
  if (kind === 'artifact') {
    // A page with the corner turned down.
    var pw = 11 * s;
    var ph = 14 * s;
    var fold = 4 * s;
    return svg.g({}, [
      svg.path({
        d:
          'M ' + t.r2(x) + ' ' + t.r2(y) +
          ' H ' + t.r2(x + pw - fold) +
          ' L ' + t.r2(x + pw) + ' ' + t.r2(y + fold) +
          ' V ' + t.r2(y + ph) +
          ' H ' + t.r2(x) + ' Z',
        fill: 'none',
        stroke: stroke,
        'stroke-width': width,
      }),
      svg.path({
        d:
          'M ' + t.r2(x + pw - fold) + ' ' + t.r2(y) +
          ' V ' + t.r2(y + fold) +
          ' H ' + t.r2(x + pw),
        fill: 'none',
        stroke: stroke,
        'stroke-width': width,
      }),
    ]);
  }
  return null;
}

function badgeWidth(kind, size) {
  if (kind === 'component') return (14 + 2.5) * (size / 16);
  if (kind === 'artifact') return 11 * (size / 16);
  return 0;
}

function badgeHeight(kind, size) {
  if (kind === 'component') return 11 * (size / 16);
  if (kind === 'artifact') return 14 * (size / 16);
  return 0;
}

/**
 * Draw a classifier.
 *
 * `spec.compartments` is a list of `{ lines, align, italic }`. A compartment with nothing
 * in it is still drawn, as a thin empty strip: in UML an empty compartment says "this
 * class has no attributes", which is not the same statement as leaving the compartment
 * off, and a component cannot tell which the author meant. `hideEmpty` on a compartment
 * says the author meant the other one.
 */
function render(ctx, spec) {
  var p = ctx.params;
  var stroke = t.pick(p.stroke, 'var(--sw-ink)');
  var fill = t.pick(p.fill, 'var(--sw-surface)');
  var ink = t.pick(p.ink, 'var(--sw-ink)');
  var muted = 'var(--sw-ink-muted)';
  var lineW = Math.max(0.2, t.numOr(p.lineWidth, 1.2));

  var nameSize = Math.max(7, t.numOr(p.fontSize, 13));
  var memberSize = Math.max(6, nameSize - 2);
  var keySize = Math.max(6, nameSize - 3);

  var variant = spec.variant || 'rect';
  var mark = spec.badge || null;

  // ---------------------------------------------------------------- header

  var head = [];
  var keyword = t.guillemets(spec.keyword);
  if (keyword) head.push({ value: keyword, size: keySize, fill: muted, weight: '400' });
  head.push({
    value: t.pick(spec.name, ' '),
    size: nameSize,
    fill: ink,
    weight: '600',
    style: spec.italic ? 'italic' : null,
    underline: !!spec.underline,
    id: 'name',
  });
  if (spec.detail) head.push({ value: spec.detail, size: keySize, fill: muted, weight: '400' });

  var headH = HEAD_PAD * 2;
  var headW = 0;
  for (var i = 0; i < head.length; i += 1) {
    headH += head[i].size * t.LEADING;
    headW = Math.max(headW, t.widthOf(head[i].value, head[i].size, { weight: head[i].weight, style: head[i].style }));
  }
  headH = Math.max(headH, badgeHeight(mark, nameSize) + HEAD_PAD * 2);

  // ---------------------------------------------------------- compartments

  var comps = [];
  var bodyW = 0;
  var declared = spec.compartments || [];
  for (var c = 0; c < declared.length; c += 1) {
    var spec_c = declared[c];
    var rows = spec_c.lines || [];
    if (rows.length === 0 && spec_c.hideEmpty) continue;
    var h = COMP_PAD * 2 + Math.max(rows.length, 1) * memberSize * t.LEADING;
    if (rows.length === 0) h = COMP_PAD * 2 + memberSize * 0.4;
    comps.push({ rows: rows, align: spec_c.align || 'start', italic: !!spec_c.italic, height: h });
    bodyW = Math.max(bodyW, t.widestOf(rows, memberSize, { family: t.MONO }));
  }

  var contentW = Math.max(headW + badgeWidth(mark, nameSize) * (mark ? 1.4 : 0), bodyW) + t.PAD * 2;
  var contentH = headH;
  for (var k = 0; k < comps.length; k += 1) contentH += comps[k].height;

  // The instance box is a floor, not a ceiling - see the note at the top of the file.
  var outerW = Math.max(t.numOr(ctx.size.w, 0), contentW, 40);
  var outerH = Math.max(t.numOr(ctx.size.h, 0), contentH, 28);

  // A deployment node gives up part of the box to the third dimension, so its face is
  // what is left; everything below is laid out on the face.
  var depth = variant === 'node' ? Math.min(NODE_DEPTH, outerW / 4, outerH / 4) : 0;
  var x = 0;
  var y = depth;
  var w = outerW - depth;
  var h = outerH - depth;

  // -------------------------------------------------------------- the body

  var children = [];
  if (depth > 0) {
    children.push(
      svg.path({
        d:
          'M ' + t.r2(x) + ' ' + t.r2(y) +
          ' L ' + t.r2(x + depth) + ' ' + t.r2(y - depth) +
          ' H ' + t.r2(x + w + depth) +
          ' V ' + t.r2(y + h - depth) +
          ' L ' + t.r2(x + w) + ' ' + t.r2(y + h) +
          ' V ' + t.r2(y) + ' Z',
        fill: fill,
        stroke: stroke,
        'stroke-width': lineW,
        'stroke-linejoin': 'round',
      }),
      svg.path({
        d: 'M ' + t.r2(x + w) + ' ' + t.r2(y) + ' L ' + t.r2(x + w + depth) + ' ' + t.r2(y - depth),
        fill: 'none',
        stroke: stroke,
        'stroke-width': lineW,
      }),
    );
  }
  children.push(
    svg.rect({
      id: 'body',
      x: t.r2(x),
      y: t.r2(y),
      width: t.r2(w),
      height: t.r2(h),
      rx: variant === 'rounded' ? t.r2(Math.min(12, h / 2, w / 2)) : null,
      fill: fill,
      stroke: stroke,
      'stroke-width': lineW,
    }),
  );

  // -------------------------------------------------------------- the text

  var mid = x + w / 2;
  var at = y + HEAD_PAD;
  for (var j = 0; j < head.length; j += 1) {
    var row = head[j];
    var step = row.size * t.LEADING;
    children.push(
      t.line(row.value, mid, at + (step - row.size) / 2, row.size, {
        id: row.id,
        anchor: 'middle',
        weight: row.weight,
        style: row.style,
        underline: row.underline,
        fill: row.fill,
      }),
    );
    at += step;
  }
  if (mark) {
    children.push(badge(mark, x + w - t.PAD - badgeWidth(mark, nameSize), y + HEAD_PAD, nameSize, stroke, lineW));
  }

  var top = y + headH;
  for (var m = 0; m < comps.length; m += 1) {
    var comp = comps[m];
    children.push(
      svg.path({
        d: 'M ' + t.r2(x) + ' ' + t.r2(top) + ' H ' + t.r2(x + w),
        fill: 'none',
        stroke: stroke,
        'stroke-width': lineW,
      }),
    );
    var laid = t.stack(comp.rows, comp.align === 'center' ? mid : x + t.PAD, top + COMP_PAD, memberSize, {
      anchor: comp.align === 'center' ? 'middle' : 'start',
      family: t.MONO,
      style: comp.italic ? 'italic' : null,
      fill: ink,
    });
    for (var n = 0; n < laid.nodes.length; n += 1) children.push(laid.nodes[n]);
    top += comp.height;
  }

  return svg.g({}, children);
}

/**
 * `order : Order`, the heading of an object diagram's instance.
 *
 * Either half may be left out - an anonymous instance is `: Order` and an instance whose
 * class does not matter is just `order` - so the colon appears only when both do.
 */
function instanceName(name, classifierName) {
  var a = String(t.pick(name, '')).trim();
  var b = String(t.pick(classifierName, '')).trim();
  if (a && b) return a + ' : ' + b;
  if (b) return ': ' + b;
  return a;
}

defineComponent({ render: render, lines: t.lines, instanceName: instanceName });
