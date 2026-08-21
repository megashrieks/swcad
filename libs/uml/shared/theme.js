/*
 * What every UML symbol in this library agrees on.
 *
 * UML is a notation before it is a picture: the same box means one thing with a keyword
 * over the name and another without, and a reader tells them apart by small, consistent
 * details - the size of the guillemets, whether the name is italic, how far the text sits
 * from the border. Those details live here rather than in thirty-odd component scripts,
 * so a change of type size or padding moves the whole library at once and no two symbols
 * can drift apart.
 */

var FONT = 'Inter, Segoe UI, sans-serif';
var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Space between a border and the text inside it. */
var PAD = 9;
/** Baseline-to-baseline as a multiple of the type size. */
var LEADING = 1.4;

function pick(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function numOr(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function r2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * A member list, one entry per line.
 *
 * The compartments of a classifier are a single parameter each rather than a list of
 * parameters, because the number of attributes on a class is not something a component
 * can declare in advance. Blank lines are dropped so trailing newlines while typing do
 * not open a gap in the drawing.
 */
function lines(value) {
  if (value === undefined || value === null) return [];
  var out = [];
  var raw = String(value).split(/\r?\n/);
  for (var i = 0; i < raw.length; i += 1) {
    var t = raw[i].trim();
    if (t) out.push(t);
  }
  return out;
}

/** «keyword», with the real guillemets rather than a pair of angle brackets. */
function guillemets(value) {
  var t = String(pick(value, '')).trim();
  if (!t) return '';
  if (t.charAt(0) === '\u00AB') return t;
  return '\u00AB' + t + '\u00BB';
}

function font(size, opts) {
  return {
    family: (opts && opts.family) || FONT,
    size: size,
    weight: (opts && opts.weight) || '400',
    style: (opts && opts.style) || 'normal',
  };
}

function widthOf(value, size, opts) {
  if (!value) return 0;
  return text.measure(String(value), font(size, opts)).width;
}

/** The widest of several strings, all set in the same face. */
function widestOf(values, size, opts) {
  var w = 0;
  for (var i = 0; i < values.length; i += 1) w = Math.max(w, widthOf(values[i], size, opts));
  return w;
}

/**
 * A run of text.
 *
 * `y` is the top of the line, not the baseline: laying a symbol out is a matter of
 * stacking boxes, and every caller would otherwise be adding the same ascent by hand.
 */
function line(value, x, y, size, opts) {
  var o = opts || {};
  return svg.text(String(value), {
    id: o.id,
    x: r2(x),
    y: r2(y + size * 0.82),
    'text-anchor': o.anchor || 'start',
    'font-family': o.family || FONT,
    'font-size': size,
    'font-weight': o.weight || '400',
    'font-style': o.style || null,
    'text-decoration': o.underline ? 'underline' : null,
    fill: o.fill || 'var(--sw-ink)',
  });
}

/**
 * A stack of member lines, returned with the height it took.
 *
 * `idFirst` names the first line, so a single-line caption can be given an id and made
 * editable on the drawing while a multi-line one - which no single element stands for -
 * is left to the inspector.
 */
function stack(values, x, y, size, opts) {
  var o = opts || {};
  var step = size * LEADING;
  var out = [];
  for (var i = 0; i < values.length; i += 1) {
    var attrs = {
      anchor: o.anchor,
      family: o.family,
      weight: o.weight,
      style: o.style,
      underline: o.underline,
      fill: o.fill,
      id: i === 0 ? o.idFirst : null,
    };
    out.push(line(values[i], x, y + i * step + (step - size) / 2, size, attrs));
  }
  return { nodes: out, height: values.length * step };
}

/** `d` for a rectangle, so a body that is sometimes a rect and sometimes not is one element. */
function rectPath(x, y, w, h) {
  return (
    'M ' + r2(x) + ' ' + r2(y) + ' H ' + r2(x + w) + ' V ' + r2(y + h) + ' H ' + r2(x) + ' Z'
  );
}

defineComponent({
  FONT: FONT,
  MONO: MONO,
  PAD: PAD,
  LEADING: LEADING,
  pick: pick,
  numOr: numOr,
  bool: bool,
  r2: r2,
  lines: lines,
  guillemets: guillemets,
  font: font,
  widthOf: widthOf,
  widestOf: widestOf,
  line: line,
  stack: stack,
  rectPath: rectPath,
});
