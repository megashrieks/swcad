/*
 * The marks of the behaviour diagrams.
 *
 * Activity, state machine, use case and sequence diagrams are mostly made of small fixed
 * shapes - a filled dot, a bar, a diamond, a stick figure - whose whole meaning is their
 * silhouette. There is nothing to share between them but the palette and the type, so this
 * is a collection of small drawings rather than a chassis; each one is exported by name and
 * a component script is a single call.
 *
 * Where a shape has a name written on it, the shape grows to hold the name. A decision
 * whose guard hung outside the diamond, or a use case with its title spilling off both
 * ends of the ellipse, would be a worse drawing than one that is simply bigger.
 */

var t = require('lib:theme');

function common(ctx) {
  var p = ctx.params;
  return {
    stroke: t.pick(p.stroke, 'var(--sw-ink)'),
    fill: t.pick(p.fill, 'var(--sw-surface)'),
    ink: t.pick(p.ink, 'var(--sw-ink)'),
    lineW: Math.max(0.2, t.numOr(p.lineWidth, 1.2)),
    size: Math.max(7, t.numOr(p.fontSize, 12)),
    w: Math.max(4, t.numOr(ctx.size.w, 80)),
    h: Math.max(4, t.numOr(ctx.size.h, 60)),
  };
}

/** A transparent ring or box that makes the whole silhouette connectable. */
function edgeCircle(cx, cy, r) {
  return svg.circle({ id: 'edge', cx: t.r2(cx), cy: t.r2(cy), r: t.r2(r), fill: 'none', stroke: 'transparent' });
}

// -------------------------------------------------------------------- actor

/**
 * The stick figure. Drawn to a fixed proportion rather than stretched to the instance box:
 * a wide actor is not a fat actor, it is a mistake.
 */
function actor(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var gap = 7;
  var textH = name ? c.size * t.LEADING : 0;
  var figH = Math.max(24, Math.min(c.h - textH - gap, c.w * 1.6));
  var figW = figH * 0.62;
  var mid = Math.max(figW, t.widthOf(name, c.size)) / 2 + 1;
  var head = figH * 0.22;
  var top = 0;

  var yHead = top + head;
  var yNeck = top + head * 2;
  var yWaist = top + figH * 0.6;
  var yFoot = top + figH;
  var arm = figW / 2;

  var children = [
    svg.rect({
      id: 'body',
      x: t.r2(mid - Math.max(figW, t.widthOf(name, c.size)) / 2 - 1),
      y: 0,
      width: t.r2(Math.max(figW, t.widthOf(name, c.size)) + 2),
      height: t.r2(figH + gap + textH),
      fill: 'none',
      stroke: 'none',
    }),
    svg.circle({
      cx: t.r2(mid),
      cy: t.r2(yHead),
      r: t.r2(head),
      fill: 'none',
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
    svg.path({
      d:
        'M ' + t.r2(mid) + ' ' + t.r2(yNeck) + ' V ' + t.r2(yWaist) +
        ' M ' + t.r2(mid - arm) + ' ' + t.r2(yNeck + head * 0.5) + ' H ' + t.r2(mid + arm) +
        ' M ' + t.r2(mid) + ' ' + t.r2(yWaist) + ' L ' + t.r2(mid - arm) + ' ' + t.r2(yFoot) +
        ' M ' + t.r2(mid) + ' ' + t.r2(yWaist) + ' L ' + t.r2(mid + arm) + ' ' + t.r2(yFoot),
      fill: 'none',
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linecap': 'round',
    }),
    edgeCircle(mid, top + figH / 2, figH / 2 + 3),
  ];
  if (name) {
    children.push(
      t.line(name, mid, yFoot + gap, c.size, { id: 'name', anchor: 'middle', fill: c.ink }),
    );
  }
  return svg.g({}, children);
}

// ----------------------------------------------------------------- use case

function useCase(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var rows = t.lines(name);
  if (rows.length === 0) rows = [''];
  var textW = t.widestOf(rows, c.size);
  var textH = rows.length * c.size * t.LEADING;
  // An ellipse only holds a rectangle of about 1/sqrt(2) its axes, so the text half-width
  // is scaled up before it becomes a radius or the words touch the curve.
  var rx = Math.max(c.w / 2, textW * 0.75 + 14);
  var ry = Math.max(c.h / 2, textH * 0.78 + 12);
  var children = [
    svg.ellipse({
      id: 'body',
      cx: t.r2(rx),
      cy: t.r2(ry),
      rx: t.r2(rx),
      ry: t.r2(ry),
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
  ];
  var laid = t.stack(rows, rx, ry - textH / 2, c.size, {
    anchor: 'middle',
    fill: c.ink,
    idFirst: rows.length === 1 ? 'name' : null,
  });
  for (var i = 0; i < laid.nodes.length; i += 1) children.push(laid.nodes[i]);
  return svg.g({}, children);
}

// ------------------------------------------------------- action / object node

function boxy(ctx, opts) {
  var c = common(ctx);
  var o = opts || {};
  var name = String(t.pick(ctx.params.name, ''));
  var rows = t.lines(name);
  var state = o.state ? String(t.pick(ctx.params.state, '')) : '';
  if (state) rows = rows.concat(['[' + state.replace(/^\[|\]$/g, '') + ']']);
  if (rows.length === 0) rows = [''];
  var textH = rows.length * c.size * t.LEADING;
  var w = Math.max(c.w, t.widestOf(rows, c.size) + t.PAD * 2);
  var h = Math.max(c.h, textH + t.PAD * 2);
  var children = [
    svg.rect({
      id: 'body',
      x: 0,
      y: 0,
      width: t.r2(w),
      height: t.r2(h),
      rx: o.round ? t.r2(Math.min(12, h / 2)) : null,
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
  ];
  var laid = t.stack(rows, w / 2, (h - textH) / 2, c.size, {
    anchor: 'middle',
    fill: c.ink,
    idFirst: rows.length === 1 ? 'name' : null,
  });
  for (var i = 0; i < laid.nodes.length; i += 1) children.push(laid.nodes[i]);
  return svg.g({}, children);
}

// ------------------------------------------------------------ control nodes

/** The filled dot an activity or a state machine starts from. */
function initialNode(ctx) {
  var c = common(ctx);
  var r = Math.max(4, Math.min(c.w, c.h) / 2);
  return svg.g({}, [
    svg.circle({ id: 'body', cx: t.r2(r), cy: t.r2(r), r: t.r2(r), fill: c.stroke, stroke: 'none' }),
  ]);
}

/** The bullseye it ends at. */
function finalNode(ctx) {
  var c = common(ctx);
  var r = Math.max(5, Math.min(c.w, c.h) / 2);
  return svg.g({}, [
    svg.circle({
      id: 'body',
      cx: t.r2(r),
      cy: t.r2(r),
      r: t.r2(r - c.lineW / 2),
      fill: 'var(--sw-paper)',
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
    svg.circle({ cx: t.r2(r), cy: t.r2(r), r: t.r2(r * 0.58), fill: c.stroke, stroke: 'none' }),
  ]);
}

/** Flow final: this path stops, the activity does not. */
function flowFinal(ctx) {
  var c = common(ctx);
  var r = Math.max(5, Math.min(c.w, c.h) / 2);
  var d = r * 0.5;
  return svg.g({}, [
    svg.circle({
      id: 'body',
      cx: t.r2(r),
      cy: t.r2(r),
      r: t.r2(r - c.lineW / 2),
      fill: 'var(--sw-paper)',
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
    svg.path({
      d:
        'M ' + t.r2(r - d) + ' ' + t.r2(r - d) + ' L ' + t.r2(r + d) + ' ' + t.r2(r + d) +
        ' M ' + t.r2(r + d) + ' ' + t.r2(r - d) + ' L ' + t.r2(r - d) + ' ' + t.r2(r + d),
      fill: 'none',
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linecap': 'round',
    }),
  ]);
}

/** A decision, a merge and a state machine's choice pseudostate are all this diamond. */
function decision(ctx) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var w = Math.max(c.w, t.widthOf(name, c.size) * 1.6 + 16, 28);
  var h = Math.max(c.h, c.size * 2.2, 22);
  var children = [
    svg.polygon({
      id: 'body',
      points:
        t.r2(w / 2) + ',0 ' + t.r2(w) + ',' + t.r2(h / 2) + ' ' + t.r2(w / 2) + ',' + t.r2(h) + ' 0,' + t.r2(h / 2),
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linejoin': 'round',
    }),
  ];
  if (name) {
    children.push(
      t.line(name, w / 2, (h - c.size) / 2, c.size, { id: 'name', anchor: 'middle', fill: c.ink }),
    );
  }
  return svg.g({}, children);
}

/** The heavy bar that splits a flow into concurrent ones, or joins them back. */
function fork(ctx) {
  var c = common(ctx);
  var vertical = t.pick(ctx.params.orientation, 'horizontal') === 'vertical';
  var thick = Math.max(3, t.numOr(ctx.params.thickness, 5));
  var span = Math.max(20, vertical ? c.h : c.w);
  var w = vertical ? thick : span;
  var h = vertical ? span : thick;
  return svg.g({}, [
    svg.rect({
      id: 'body',
      x: 0,
      y: 0,
      width: t.r2(w),
      height: t.r2(h),
      fill: c.stroke,
      stroke: 'none',
    }),
  ]);
}

/** The H (or H*) of a state machine's history pseudostate. */
function history(ctx) {
  var c = common(ctx);
  var deep = Boolean(ctx.params.deep);
  var r = Math.max(8, Math.min(c.w, c.h) / 2);
  return svg.g({}, [
    svg.circle({
      id: 'body',
      cx: t.r2(r),
      cy: t.r2(r),
      r: t.r2(r - c.lineW / 2),
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
    t.line(deep ? 'H*' : 'H', r, r - r * 0.62, r * 1.15, { anchor: 'middle', weight: '600', fill: c.ink }),
  ]);
}

// ------------------------------------------------------------------ signals

/** Send is a pentagon pointing out of the action; receive is one notched into it. */
function signal(ctx, receive) {
  var c = common(ctx);
  var name = String(t.pick(ctx.params.name, ''));
  var notch = 12;
  var w = Math.max(c.w, t.widthOf(name, c.size) + t.PAD * 2 + notch);
  var h = Math.max(c.h, c.size * t.LEADING + t.PAD * 2, 26);
  var pts = receive
    ? '0,0 ' + t.r2(w) + ',0 ' + t.r2(w) + ',' + t.r2(h) + ' 0,' + t.r2(h) + ' ' + t.r2(notch) + ',' + t.r2(h / 2)
    : '0,0 ' + t.r2(w - notch) + ',0 ' + t.r2(w) + ',' + t.r2(h / 2) + ' ' + t.r2(w - notch) + ',' + t.r2(h) + ' 0,' + t.r2(h);
  return svg.g({}, [
    svg.polygon({
      id: 'body',
      points: pts,
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-linejoin': 'round',
    }),
    t.line(name, (w + (receive ? notch : -notch)) / 2, (h - c.size) / 2, c.size, {
      id: 'name',
      anchor: 'middle',
      fill: c.ink,
    }),
  ]);
}

// ----------------------------------------------------------------- lifeline

/**
 * A sequence diagram lifeline: the head, the dashed line of time below it, and an optional
 * execution bar.
 *
 * The spine carries the port, not the head. A message is an event at a moment, so it lands
 * at a height on the line rather than on the object it belongs to, and making the head
 * connectable as well would let a message aimed at second 40 snap back up to the box.
 */
function lifeline(ctx) {
  var c = common(ctx);
  var p = ctx.params;
  var name = String(t.pick(p.name, ''));
  var type = String(t.pick(p.type, ''));
  var heading = type ? name + ' : ' + type : name;
  var headH = Math.max(26, c.size * t.LEADING + t.PAD * 2);
  var headW = Math.max(c.w, t.widthOf(heading, c.size, { weight: '600' }) + t.PAD * 2, 60);
  var h = Math.max(c.h, headH + 60);
  var mid = headW / 2;

  var children = [
    svg.rect({
      id: 'body',
      x: 0,
      y: 0,
      width: t.r2(headW),
      height: t.r2(headH),
      fill: c.fill,
      stroke: c.stroke,
      'stroke-width': c.lineW,
    }),
    t.line(heading, mid, (headH - c.size) / 2, c.size, {
      id: 'name',
      anchor: 'middle',
      weight: '600',
      underline: Boolean(p.instance),
      fill: c.ink,
    }),
    svg.path({
      id: 'spine',
      d: 'M ' + t.r2(mid) + ' ' + t.r2(headH) + ' V ' + t.r2(h),
      fill: 'none',
      stroke: c.stroke,
      'stroke-width': c.lineW,
      'stroke-dasharray': '6 5',
    }),
  ];

  var barTop = t.numOr(p.activationFrom, 0);
  var barLen = t.numOr(p.activationLength, 0);
  if (barLen > 0) {
    var bw = Math.max(6, t.numOr(p.activationWidth, 10));
    children.push(
      svg.rect({
        id: 'activation',
        x: t.r2(mid - bw / 2),
        y: t.r2(headH + Math.max(0, barTop)),
        width: t.r2(bw),
        height: t.r2(barLen),
        fill: 'var(--sw-surface)',
        stroke: c.stroke,
        'stroke-width': c.lineW,
      }),
    );
  }
  if (p.destroyed) {
    var d = 7;
    children.push(
      svg.path({
        d:
          'M ' + t.r2(mid - d) + ' ' + t.r2(h - d) + ' L ' + t.r2(mid + d) + ' ' + t.r2(h + d) +
          ' M ' + t.r2(mid + d) + ' ' + t.r2(h - d) + ' L ' + t.r2(mid - d) + ' ' + t.r2(h + d),
        fill: 'none',
        stroke: c.stroke,
        'stroke-width': c.lineW * 1.6,
        'stroke-linecap': 'round',
      }),
    );
  }
  return svg.g({}, children);
}

defineComponent({
  common: common,
  actor: actor,
  useCase: useCase,
  boxy: boxy,
  initialNode: initialNode,
  finalNode: finalNode,
  flowFinal: flowFinal,
  decision: decision,
  fork: fork,
  history: history,
  signal: signal,
  lifeline: lifeline,
});
