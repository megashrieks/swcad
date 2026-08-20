// Deterministic randomness for the generative library.
//
// Component scripts have no Math.random (the sandbox withholds it) and could not use it
// anyway: a render must be a pure function of its params, or the drawing would flicker on
// every reflow and never survive a reload. Everything here is seeded and repeatable.
//
//   var random = require('lib:random');
//   var rand = random.rng(params.seed);      // rand() -> [0, 1)
//   var n = random.fbm(x, y, params.seed);   // smooth field -> [0, 1]

/** mulberry32: small, fast, and good enough that a bumped seed looks unrelated. */
function rng(seed) {
  var a = (Math.floor(seed) || 0) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash of a lattice point -> [0, 1). Stateless, so the field can be sampled in any order. */
function hash2(ix, iy, seed) {
  var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise on the unit lattice -> [0, 1]. */
function noise2(x, y, seed) {
  var x0 = Math.floor(x);
  var y0 = Math.floor(y);
  var fx = smoothstep(x - x0);
  var fy = smoothstep(y - y0);
  var a = hash2(x0, y0, seed);
  var b = hash2(x0 + 1, y0, seed);
  var c = hash2(x0, y0 + 1, seed);
  var d = hash2(x0 + 1, y0 + 1, seed);
  var top = a + (b - a) * fx;
  var bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal brownian motion: octaves of value noise -> [0, 1]. */
function fbm(x, y, seed, octaves) {
  var n = Math.max(1, Math.floor(octaves || 4));
  var sum = 0;
  var amp = 1;
  var freq = 1;
  var norm = 0;
  for (var i = 0; i < n; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Round for output: keeps the emitted SVG small without a visible loss of precision. */
function r2(v) {
  return Math.round(v * 100) / 100;
}

/** The five chart tokens, so a piece picks up whatever palette it is viewed in. */
var RAMP = ['var(--sw-1)', 'var(--sw-2)', 'var(--sw-3)', 'var(--sw-4)', 'var(--sw-5)'];

/** Sample the ramp with t in [0, 1]. Discrete: SVG cannot interpolate two CSS variables. */
function ramp(t) {
  var i = Math.floor(t * RAMP.length);
  if (i < 0) i = 0;
  if (i >= RAMP.length) i = RAMP.length - 1;
  return RAMP[i];
}

/** Splits a comma separated colour list, falling back to the chart ramp. */
function palette(text) {
  if (typeof text !== 'string') return RAMP.slice();
  var parts = text.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var c = parts[i].replace(/^\s+/, '').replace(/\s+$/, '');
    if (c) out.push(c);
  }
  return out.length ? out : RAMP.slice();
}

defineComponent({
  rng: rng,
  hash2: hash2,
  noise2: noise2,
  fbm: fbm,
  r2: r2,
  ramp: ramp,
  palette: palette,
  RAMP: RAMP,
});
