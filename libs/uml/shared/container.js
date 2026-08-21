/*
 * The containers: the outlines you draw around other things.
 *
 * A package, a diagram frame, a combined fragment and an activity partition are all the
 * same idea - a border with a label somewhere on it and whatever you like inside - and
 * they share one problem that the classifier boxes do not have. A classifier is an opaque
 * card, so a connector should go round it. A container is a region, and the nodes it holds
 * are inside it, so a connector that went round the border could never reach them.
 *
 * The border is therefore drawn as four separate strokes rather than one rectangle. The
 * engine treats each drawn primitive as its own obstacle, so four thin bars leave the
 * middle open while a single rect would seal it. All four carry a port under the same
 * name, which the engine reads as one logical port with four places to land, so a
 * connector still attaches to whichever edge it is nearest.
 */

var t = require('lib:theme');

var TAB_H = 18;
var TAG_H = 17;

function edgePath(id, d, stroke, lineW, dash) {
  return svg.path({
    id: id,
    d: d,
    fill: 'none',
    stroke: stroke,
    'stroke-width': lineW,
    'stroke-dasharray': dash || null,
    'stroke-linejoin': 'miter',
  });
}

/** The four sides of a rectangle as four elements. `topD` replaces the top for a shaped one. */
function border(x, y, w, h, stroke, lineW, topD, dash) {
  var x2 = t.r2(x + w);
  var y2 = t.r2(y + h);
  var x1 = t.r2(x);
  var y1 = t.r2(y);
  return [
    edgePath('top', topD || 'M ' + x1 + ' ' + y1 + ' H ' + x2, stroke, lineW, dash),
    edgePath('right', 'M ' + x2 + ' ' + y1 + ' V ' + y2, stroke, lineW, dash),
    edgePath('bottom', 'M ' + x2 + ' ' + y2 + ' H ' + x1, stroke, lineW, dash),
    edgePath('left', 'M ' + x1 + ' ' + y2 + ' V ' + y1, stroke, lineW, dash),
  ];
}

/**
 * The pentagon a UML 2 frame wears in its top-left corner: a rectangle with the
 * bottom-right corner cut off.
 */
function tag(x, y, w, h, stroke, lineW, fill) {
  var cut = Math.min(h * 0.42, 9);
  return svg.path({
    d:
      'M ' + t.r2(x) + ' ' + t.r2(y) +
      ' H ' + t.r2(x + w) +
      ' V ' + t.r2(y + h - cut) +
      ' L ' + t.r2(x + w - cut) + ' ' + t.r2(y + h) +
      ' H ' + t.r2(x) + ' Z',
    fill: fill,
    stroke: stroke,
    'stroke-width': lineW,
    'stroke-linejoin': 'round',
  });
}

function common(ctx) {
  var p = ctx.params;
  return {
    stroke: t.pick(p.stroke, 'var(--sw-ink)'),
    fill: t.pick(p.fill, 'none'),
    ink: t.pick(p.ink, 'var(--sw-ink)'),
    lineW: Math.max(0.2, t.numOr(p.lineWidth, 1.2)),
    size: Math.max(7, t.numOr(p.fontSize, 12)),
    w: Math.max(40, t.numOr(ctx.size.w, 200)),
    h: Math.max(30, t.numOr(ctx.size.h, 140)),
  };
}

/** A tinted interior, drawn behind everything and never a port or an obstacle. */
function wash(c) {
  if (!c.fill || c.fill === 'none') return null;
  return svg.rect({ x: 0, y: 0, width: t.r2(c.w), height: t.r2(c.h), fill: c.fill, stroke: 'none' });
}

// ------------------------------------------------------------------ package

function renderPackage(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var tabW = Math.min(c.w - 12, Math.max(56, t.widthOf(name, c.size, { weight: '600' }) + t.PAD * 2));
  var top =
    'M 0 0 H ' + t.r2(tabW) + ' V ' + TAB_H + ' H ' + t.r2(c.w);
  var children = [wash(c)];
  children = children.concat(border(0, TAB_H, c.w, c.h - TAB_H, c.stroke, c.lineW, top));
  children.push(
    t.line(name, t.PAD, (TAB_H - c.size) / 2, c.size, { id: 'name', weight: '600', fill: c.ink }),
  );
  return svg.g({}, children);
}

// -------------------------------------------------------------------- frame

/** A diagram frame, or a combined fragment - the same drawing with a different word in the tag. */
function renderFrame(ctx, opts) {
  var c = common(ctx);
  var o = opts || {};
  var kind = String(t.pick(ctx.params.kind, o.kind || ''));
  var name = String(t.pick(ctx.params.name, ''));
  var heading = kind ? (name ? kind + ' ' + name : kind) : name;
  var tagW = Math.max(34, t.widthOf(heading, c.size, { weight: '600' }) + t.PAD * 2 + 9);

  var children = [wash(c)];
  children = children.concat(border(0, 0, c.w, c.h, c.stroke, c.lineW));
  children.push(tag(0, 0, tagW, TAG_H + 3, c.stroke, c.lineW, 'var(--sw-paper)'));
  children.push(
    t.line(heading, t.PAD * 0.8, (TAG_H + 3 - c.size) / 2, c.size, {
      id: 'name',
      weight: '600',
      fill: c.ink,
    }),
  );

  var guard = String(t.pick(ctx.params.guard, ''));
  if (guard) {
    children.push(
      t.line(bracket(guard), t.PAD, TAG_H + 8, c.size, { id: 'guard', fill: c.ink, family: t.MONO }),
    );
  }

  // Each extra operand of a combined fragment is a dashed rule with its own guard, which
  // is what makes `alt` two branches rather than one box with two words in it.
  var operands = t.lines(ctx.params.operands);
  if (operands.length) {
    var span = c.h - TAG_H - 3;
    for (var i = 0; i < operands.length; i += 1) {
      var at = TAG_H + 3 + (span * (i + 1)) / (operands.length + 1);
      children.push(
        svg.path({
          d: 'M 0 ' + t.r2(at) + ' H ' + t.r2(c.w),
          fill: 'none',
          stroke: c.stroke,
          'stroke-width': c.lineW,
          'stroke-dasharray': '7 5',
        }),
        t.line(bracket(operands[i]), t.PAD, at + 4, c.size, { fill: c.ink, family: t.MONO }),
      );
    }
  }
  return svg.g({}, children);
}

/** A UML guard reads `[condition]`; typing the brackets as well should not double them. */
function bracket(value) {
  var s = String(value).trim();
  if (!s) return '';
  return s.charAt(0) === '[' ? s : '[' + s + ']';
}

// ---------------------------------------------------------------- partition

function renderPartition(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var vertical = t.pick(ctx.params.orientation, 'vertical') !== 'horizontal';
  var head = Math.max(c.size + 10, 22);

  var children = [wash(c)];
  children = children.concat(border(0, 0, c.w, c.h, c.stroke, c.lineW));
  if (vertical) {
    children.push(
      svg.path({ d: 'M 0 ' + t.r2(head) + ' H ' + t.r2(c.w), fill: 'none', stroke: c.stroke, 'stroke-width': c.lineW }),
      t.line(name, t.r2(c.w / 2), (head - c.size) / 2, c.size, {
        id: 'name',
        anchor: 'middle',
        weight: '600',
        fill: c.ink,
      }),
    );
  } else {
    var ax = t.r2(head / 2);
    var ay = t.r2(c.h / 2);
    children.push(
      svg.path({ d: 'M ' + t.r2(head) + ' 0 V ' + t.r2(c.h), fill: 'none', stroke: c.stroke, 'stroke-width': c.lineW }),
      svg.text(name, {
        id: 'name',
        x: ax,
        y: ay,
        // Turned anticlockwise, so a lane title on the left reads bottom to top rather
        // than upside down.
        transform: 'rotate(-90 ' + ax + ' ' + ay + ')',
        'text-anchor': 'middle',
        'font-family': t.FONT,
        'font-size': c.size,
        'font-weight': '600',
        fill: c.ink,
      }),
    );
  }
  return svg.g({}, children);
}

// ----------------------------------------------------------------- boundary

/** The system boundary of a use case diagram: a plain rectangle with its name at the top. */
function renderBoundary(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var children = [wash(c)];
  children = children.concat(border(0, 0, c.w, c.h, c.stroke, c.lineW));
  children.push(
    t.line(name, t.r2(c.w / 2), t.PAD, c.size, { id: 'name', anchor: 'middle', weight: '600', fill: c.ink }),
  );
  return svg.g({}, children);
}

// --------------------------------------------------------------------- note

/**
 * A comment. Unlike the others this one is a card rather than a region - you read it, you
 * do not put anything inside it - so it is a single filled shape with a hit area, and a
 * connector goes round it like any other node.
 */
function renderNote(ctx) {
  var c = common(ctx);
  var fill = t.pick(ctx.params.fill, 'var(--sw-surface)');
  var fold = 14;
  var body = String(t.pick(ctx.params.text, ''));
  var rows = t.lines(body);
  var need = t.PAD * 2 + Math.max(rows.length, 1) * c.size * t.LEADING;
  var w = Math.max(c.w, t.widestOf(rows, c.size) + t.PAD * 2 + fold);
  var h = Math.max(c.h, need);

  var children = [
    svg.path({
      id: 'body',
      d:
        'M 0 0 H ' + t.r2(w - fold) +
        ' L ' + t.r2(w) + ' ' + t.r2(fold) +
        ' V ' + t.r2(h) + ' H 0 Z',
      fill: fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linejoin': 'round',
    }),
    svg.path({
      d: 'M ' + t.r2(w - fold) + ' 0 V ' + t.r2(fold) + ' H ' + t.r2(w),
      fill: 'none',
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linejoin': 'round',
    }),
  ];
  var laid = t.stack(rows, t.PAD, t.PAD, c.size, { fill: c.ink });
  for (var i = 0; i < laid.nodes.length; i += 1) children.push(laid.nodes[i]);
  return svg.g({}, children);
}

defineComponent({
  border: border,
  tag: tag,
  common: common,
  bracket: bracket,
  renderPackage: renderPackage,
  renderFrame: renderFrame,
  renderPartition: renderPartition,
  renderBoundary: renderBoundary,
  renderNote: renderNote,
});
