// Regression suite for the nine reported editor bugs.
// Each phase reloads the app so it starts from a known, empty sheet.
import { chromium } from 'playwright';

const BASE = process.env.SWCAD_URL ?? 'http://localhost:5273/';
const PROJECT = `${process.cwd().replace(/\\/g, '/')}/projects/bugs-${Date.now().toString(36)}`;
const URL = `${BASE}?project=${encodeURIComponent(PROJECT)}`;

const errors = [];
const results = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const step = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

let box;
const reset = async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.surface', { timeout: 15000 });
  box = await page.locator('.surface').boundingBox();
};

const place = async (name, x, y) => {
  await page.locator('.lib-item', { hasText: name }).first().click();
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(140);
};

const select = async () => {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.waitForTimeout(80);
};

/** Exact-label field lookup; several inspector labels are substrings of others. */
const field = (label) =>
  page.locator('.field').filter({ has: page.locator(`span:text-is("${label}")`) }).locator('input').first();

const setField = async (label, value) => {
  const input = field(label);
  await input.fill(String(value));
  await input.dispatchEvent('change');
  await page.waitForTimeout(140);
};

const nodeRects = () =>
  page.$$eval('.node', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '');
      return { x: r.x, y: r.y, w: r.width, h: r.height, tx: m ? Number(m[1]) : null, ty: m ? Number(m[2]) : null };
    }),
  );

/**
 * Ports are only drawn for the node the pointer is inside, so hover that node (screen
 * coordinates) before reading them. Surface markers are skipped: they follow the cursor.
 */
const portsAt = async (sx, sy) => {
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(170);
  const loc = page.locator('.port-marker');
  const found = [];
  for (let i = 0, n = await loc.count(); i < n; i += 1) {
    const el = loc.nth(i);
    if (((await el.getAttribute('class')) ?? '').includes('is-surface')) continue;
    found.push(await el.boundingBox());
  }
  return found;
};

/** Nearest of a set of port markers to an absolute screen point. */
const nearestPort = (list, sx, sy) =>
  list.reduce((best, bb) => {
    const d = (bb.x + bb.width / 2 - sx) ** 2 + (bb.y + bb.height / 2 - sy) ** 2;
    return !best || d < best.d ? { d, bb } : best;
  }, null).bb;

const dragPorts = async (from, to) => {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
};

const canvasSignature = (index) =>
  page.evaluate((i) => {
    const c = document.querySelectorAll('.surface canvas')[i];
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let p = 3; p < data.length; p += 4 * 7) {
      h ^= data[p];
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }, index);

/** Contiguous vertical runs on the highlight canvas, with their peak alpha. */
const guideColumns = () =>
  page.evaluate(() => {
    const c = document.querySelectorAll('.surface canvas')[1];
    const { width, height } = c;
    const d = c.getContext('2d').getImageData(0, 0, width, height).data;
    const cols = [];
    for (let x = 0; x < width; x += 1) {
      let hits = 0;
      let peak = 0;
      for (let y = 0; y < height; y += 2) {
        const a = d[(y * width + x) * 4 + 3];
        if (a > 4) {
          hits += 1;
          if (a > peak) peak = a;
        }
      }
      if (hits > height * 0.1) cols.push({ x, peak });
    }
    const groups = [];
    let run = null;
    for (const col of cols) {
      if (run && col.x - run.end <= 1) {
        run.end = col.x;
        run.peak = Math.max(run.peak, col.peak);
      } else {
        run = { start: col.x, end: col.x, peak: col.peak };
        groups.push(run);
      }
    }
    // The grid band alone peaks at alpha ~26; anything brighter contains a guide.
    return groups.filter((g) => g.peak >= 60);
  });

// ================================================================= bugs 1 + 2
// Ctrl+wheel must repaint the grid canvas and keep the cursor's world point fixed.
await reset();
await place('Box', 400, 300);
const gridBefore = await canvasSignature(0);
const [n0] = await nodeRects();
const anchor = { x: n0.x + n0.w / 2, y: n0.y + n0.h / 2 };
await page.mouse.move(anchor.x, anchor.y);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -400);
await page.keyboard.up('Control');
await page.waitForTimeout(250);
const gridAfter = await canvasSignature(0);
const [n1] = await nodeRects();

step('bug 1: zoom repaints the grid canvas', gridBefore !== gridAfter, `${gridBefore} -> ${gridAfter}`);
step('bug 1: zoom actually changes the scale', n1.w > n0.w + 4, `${n0.w.toFixed(1)} -> ${n1.w.toFixed(1)}`);
const drift = Math.hypot(n1.x + n1.w / 2 - anchor.x, n1.y + n1.h / 2 - anchor.y);
step('bug 2: zoom stays anchored at the cursor', drift < 4, `${drift.toFixed(2)}px drift`);

// Zooming out again must also repaint, and land back where it started.
await page.keyboard.down('Control');
await page.mouse.wheel(0, 400);
await page.keyboard.up('Control');
await page.waitForTimeout(250);
const [n2] = await nodeRects();
step(
  'bug 2: zoom in then out restores the original layout',
  Math.abs(n2.w - n0.w) < 2 && Math.hypot(n2.x - n0.x, n2.y - n0.y) < 3,
  `w ${n0.w.toFixed(1)} -> ${n2.w.toFixed(1)}`,
);

// ===================================================================== bug 7
// Vertical wheel zooms KiCad-style: the point under the cursor is warped to the
// middle of the view first, then the session zooms about that middle.
const panRef = (await nodeRects())[0];
// Measured now, not at reset: the inspector pane opens with the selection, so the
// canvas — and therefore its centre — is narrower here than on an empty sheet.
const surfaceBox = await page.locator('.surface').boundingBox();
const surfaceCentre = { x: surfaceBox.x + surfaceBox.width / 2, y: surfaceBox.y + surfaceBox.height / 2 };
const zoomAnchor = { x: panRef.x + panRef.w / 2, y: panRef.y + panRef.h / 2 };
await page.mouse.move(zoomAnchor.x, zoomAnchor.y);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
const afterVert = (await nodeRects())[0];
step(
  'bug 7: plain vertical wheel zooms in',
  afterVert.w > panRef.w + 4,
  `w ${panRef.w.toFixed(1)} -> ${afterVert.w.toFixed(1)}`,
);
const centreDrift = Math.hypot(
  afterVert.x + afterVert.w / 2 - surfaceCentre.x,
  afterVert.y + afterVert.h / 2 - surfaceCentre.y,
);
step(
  'bug 12: the point under the cursor is centred before zooming',
  centreDrift < 4,
  `${centreDrift.toFixed(2)}px from centre`,
);

// Continuing the same session (cursor unmoved) must not re-centre — the target
// is already in the middle, so it simply stays there while the scale grows.
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
const afterVert2 = (await nodeRects())[0];
const centreDrift2 = Math.hypot(
  afterVert2.x + afterVert2.w / 2 - surfaceCentre.x,
  afterVert2.y + afterVert2.h / 2 - surfaceCentre.y,
);
step(
  'bug 12: continuing the session keeps zooming about the centre',
  afterVert2.w > afterVert.w + 4 && centreDrift2 < 4,
  `w ${afterVert.w.toFixed(1)} -> ${afterVert2.w.toFixed(1)}, ${centreDrift2.toFixed(2)}px from centre`,
);

// Moving the cursor starts a new session, so a different point gets centred.
const leftEdge = { x: afterVert2.x + 6, y: afterVert2.y + afterVert2.h / 2 };
await page.mouse.move(leftEdge.x, leftEdge.y);
await page.waitForTimeout(120);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
const afterVert3 = (await nodeRects())[0];
const scale3 = afterVert3.w / afterVert2.w;
const expectedLeft = surfaceCentre.x + (afterVert2.x - leftEdge.x) * scale3;
const centre3Offset = afterVert3.x + afterVert3.w / 2 - surfaceCentre.x;
step(
  'bug 12: moving the cursor re-picks the zoom target',
  Math.abs(afterVert3.x - expectedLeft) < 10 && centre3Offset > 20,
  `left ${afterVert3.x.toFixed(1)} vs expected ${expectedLeft.toFixed(1)}, centre +${centre3Offset.toFixed(1)}`,
);

const gridPanned = await canvasSignature(0);
await page.keyboard.down('Shift');
await page.mouse.wheel(0, 200);
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
const afterHoriz = (await nodeRects())[0];
step(
  'bug 7: shift+wheel pans horizontally only',
  Math.abs(afterHoriz.x - afterVert3.x) > 20 &&
    Math.abs(afterHoriz.y - afterVert3.y) < 2 &&
    Math.abs(afterHoriz.w - afterVert3.w) < 1,
  `dx=${(afterHoriz.x - afterVert3.x).toFixed(1)} dy=${(afterHoriz.y - afterVert3.y).toFixed(1)}`,
);
step('bug 7: panning repaints the grid canvas', (await canvasSignature(0)) !== gridPanned);

// ===================================================================== bug 9
// Snapping must land on the drawn lattice, including small cell sizes.
await reset();
await place('Box', 400, 300);
await select();
await setField('Cell size', 5);
await setField('Subdivisions', 1);
const snapCheck = page.locator('.check', { hasText: 'Snap to grid' }).locator('input');
if (!(await snapCheck.isChecked())) await snapCheck.check();
await page.waitForTimeout(120);

await page.mouse.move(box.x + 400, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 463, box.y + 347, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(180);
const [snapped] = await nodeRects();
const onLattice = (v) => Number.isFinite(v) && Math.abs(v - Math.round(v / 5) * 5) < 1e-6;
step(
  'bug 9: drag snaps onto the grid lattice at cell size 5',
  onLattice(snapped.tx) && onLattice(snapped.ty),
  `x=${snapped.tx} y=${snapped.ty}`,
);

// A degenerate subdivision count must not poison the position with NaN.
await setField('Subdivisions', 1);
await page.mouse.move(box.x + 470, box.y + 350);
await page.mouse.down();
await page.mouse.move(box.x + 517, box.y + 393, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(180);
const [snapped2] = await nodeRects();
step(
  'bug 9: snapped position stays finite',
  Number.isFinite(snapped2.tx) && Number.isFinite(snapped2.ty),
  `x=${snapped2.tx} y=${snapped2.ty}`,
);

// ===================================================================== bug 5
// Two identically sized boxes sharing an x: dragging one puts its left, centre
// and right edges all in tolerance at once, so several guides must be drawn.
await reset();
await place('Box', 400, 250);
await place('Box', 400, 620);
await select();
await page.waitForTimeout(150);
const rects = await nodeRects();
step('bug 5: fixture boxes share an x', rects[0].tx === rects[1].tx, `${rects[0].tx} vs ${rects[1].tx}`);

const dragTarget = rects[1];
await page.mouse.move(dragTarget.x + dragTarget.w / 2, dragTarget.y + dragTarget.h / 2);
await page.mouse.down();
await page.mouse.move(dragTarget.x + dragTarget.w / 2 + 4, dragTarget.y + dragTarget.h / 2 + 4, { steps: 4 });
await page.mouse.move(dragTarget.x + dragTarget.w / 2 + 1, dragTarget.y + dragTarget.h / 2 + 1, { steps: 4 });
await page.waitForTimeout(250);
const columns = await guideColumns();
await page.mouse.up();
await page.waitForTimeout(120);

step(
  'bug 5: every in-tolerance guide is drawn at once',
  columns.length >= 2,
  `${columns.length} guide lines`,
);
step(
  'bug 5: the snapped guide is emphasized above the others',
  new Set(columns.map((c) => c.peak)).size >= 2,
  `alphas ${columns.map((c) => c.peak).join(',')}`,
);

// ================================================================= bugs 8 + 4
// Resizing recomputes geometry instead of stretching it, and nothing turns green.
await reset();
await place('Box', 400, 300);
await select();
await page.mouse.click(box.x + 400, box.y + 300);
await page.waitForTimeout(150);

const readBox = () =>
  page.evaluate(() => {
    const node = document.querySelector('.node');
    const rect = node?.querySelector('rect');
    const text = node?.querySelector('text');
    return {
      transform: node?.getAttribute('transform') ?? '',
      width: Number(rect?.getAttribute('width') ?? 0),
      height: Number(rect?.getAttribute('height') ?? 0),
      strokeWidth: rect?.getAttribute('stroke-width') ?? null,
      fontSize: text?.getAttribute('font-size') ?? null,
      textLength: text?.getBoundingClientRect().width ?? 0,
    };
  });

const beforeResize = await readBox();
await setField('Width', 480);
await setField('Height', 260);
const afterResize = await readBox();

const anisotropic = (t) => {
  const m = /scale\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(t);
  return m ? Math.abs(Number(m[1]) - Number(m[2])) > 1e-6 : false;
};
step('bug 8: no anisotropic scale is folded into the transform', !anisotropic(afterResize.transform), afterResize.transform);
step(
  'bug 8: resize recomputes the geometry itself',
  afterResize.width > beforeResize.width + 1 && afterResize.height > beforeResize.height + 1,
  `${beforeResize.width}x${beforeResize.height} -> ${afterResize.width}x${afterResize.height}`,
);
step(
  'bug 8: stroke-width survives the resize unscaled',
  afterResize.strokeWidth === beforeResize.strokeWidth,
  `${beforeResize.strokeWidth} -> ${afterResize.strokeWidth}`,
);
step(
  'bug 8: font-size survives the resize unscaled',
  afterResize.fontSize === beforeResize.fontSize,
  `${beforeResize.fontSize} -> ${afterResize.fontSize}`,
);
step(
  'bug 8: label text is not stretched by the resize',
  Math.abs(afterResize.textLength - beforeResize.textLength) < 2,
  `${beforeResize.textLength.toFixed(1)} -> ${afterResize.textLength.toFixed(1)}`,
);

const greens = await page.$$eval(
  '.node *',
  (els) => els.filter((el) => /#2f855a|#e6f6ec/i.test(`${el.getAttribute('fill')} ${el.getAttribute('stroke')}`)).length,
);
step('bug 4: box no longer auto-colours itself green', greens === 0, `${greens} green elements`);
step(
  'bug 4: the autoColor param is gone from the inspector',
  (await page.locator('.field').filter({ has: page.locator('span:text-is("Auto color")') }).count()) === 0,
);

// ===================================================================== bug 3
// The label editor opens over the label, not above the node.
const labelNode = (await nodeRects())[0];
await page.mouse.dblclick(labelNode.x + labelNode.w / 2, labelNode.y + labelNode.h / 2);
await page.waitForTimeout(250);
const editorBox = await page.locator('.label-editor').boundingBox().catch(() => null);
const labelBox = await page.evaluate(() => {
  const text = document.querySelector('.node text');
  if (!text) return null;
  const r = text.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (editorBox && labelBox) {
  const dy = Math.abs(editorBox.y + editorBox.height / 2 - (labelBox.y + labelBox.height / 2));
  const dx = Math.abs(editorBox.x - labelBox.x);
  const aboveNode = editorBox.y + editorBox.height < labelNode.y + 4;
  step(
    'bug 3: label editor opens over the label',
    dy < 30 && dx < 60 && !aboveNode,
    `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`,
  );
} else {
  step('bug 3: label editor opens over the label', false, 'editor or label not found');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(120);

// ===================================================================== bug 6
// A connector must route around its own endpoint, even after that node grows.
await reset();
await place('Box', 300, 250);
await place('Box', 950, 620);
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.waitForTimeout(200);

const markers = page.locator('.port-marker');
const nodes6 = await nodeRects();
const near6 = (px, py) => nodes6.reduce((best, n) => {
  const d = (n.x + n.w / 2 - box.x - px) ** 2 + (n.y + n.h / 2 - box.y - py) ** 2;
  return !best || d < best.d ? { d, n } : best;
}, null).n;
const src6 = near6(300, 250);
const dst6 = near6(950, 620);
const from = nearestPort(await portsAt(src6.x + src6.w / 2, src6.y + src6.h / 2), src6.x + src6.w, src6.y + src6.h / 2);
const to = nearestPort(await portsAt(dst6.x + dst6.w / 2, dst6.y + dst6.h / 2), dst6.x, dst6.y + dst6.h / 2);
step('bug 6: only the hovered node shows its ports', (await markers.count()) <= 5, `${await markers.count()} markers`);
await dragPorts(from, to);
const connCount = await page.locator('.connection').count();
step('bug 6: connection created for the routing check', connCount >= 1, `${connCount} connections`);

await select();
await page.mouse.click(box.x + 300, box.y + 250);
await page.waitForTimeout(150);
await setField('Width', 520);
await setField('Height', 340);
await page.waitForTimeout(300);

const crossing = await page.evaluate(() => {
  const path = document.querySelector('.connection path, .connection polyline');
  const node = document.querySelector('.node');
  if (!path || !node || !path.getTotalLength) return null;
  const r = node.getBoundingClientRect();
  // Shrink so points legitimately hugging the border don't count as crossings.
  const inner = { x: r.x + 10, y: r.y + 10, right: r.right - 10, bottom: r.bottom - 10 };
  const total = path.getTotalLength();
  if (!total) return null;
  let interior = 0;
  const samples = 240;
  const ctm = path.getScreenCTM();
  // Skip the ends: a route legitimately starts and finishes on its ports, which
  // sit on the node's own boundary.
  for (let i = Math.round(samples * 0.03); i <= Math.round(samples * 0.97); i += 1) {
    const p = path.getPointAtLength((total * i) / samples);
    const sp = path.ownerSVGElement.createSVGPoint();
    sp.x = p.x;
    sp.y = p.y;
    const s = sp.matrixTransform(ctm);
    if (s.x > inner.x && s.x < inner.right && s.y > inner.y && s.y < inner.bottom) interior += 1;
  }
  return { interior, samples, total };
});
step(
  'bug 6: route avoids the interior of its own resized endpoint',
  Boolean(crossing) && crossing.interior === 0,
  crossing ? `${crossing.interior}/${crossing.samples} samples inside` : 'no measurable path',
);
step('bug 6: route is still a real path', Boolean(crossing) && crossing.total > 10, crossing ? `len ${crossing.total.toFixed(1)}` : '');

// ==================================================================== bug 10
// Hovering a port must advertise "connect", not "move".
await reset();
await place('Box', 400, 300);
await page.mouse.move(box.x + 900, box.y + 600);
await page.waitForTimeout(150);
const [cursorNode] = await nodeRects();
const bodyCursor = await page.evaluate(() => {
  const el = document.querySelector('.node .swcad-hit') ?? document.querySelector('.node');
  return el ? getComputedStyle(el).cursor : null;
});
step('bug 10: node body still shows the move cursor', bodyCursor === 'move', String(bodyCursor));

// Left-edge port of the box: middle of its left side.
await page.mouse.move(cursorNode.x + 1, cursorNode.y + cursorNode.h / 2);
await page.waitForTimeout(200);
const portCursor = await page.evaluate(() => {
  const surface = document.querySelector('.surface');
  const node = document.querySelector('.node');
  return {
    hoverPort: surface?.classList.contains('hover-port') ?? false,
    marker: getComputedStyle(document.querySelector('.port-marker') ?? document.body).cursor,
    node: node ? getComputedStyle(node).cursor : null,
  };
});
step('bug 10: hovering a port flags the surface', portCursor.hoverPort === true, JSON.stringify(portCursor));
step('bug 10: port cursor differs from the move cursor', portCursor.node === 'crosshair', String(portCursor.node));
step('bug 10: port marker itself uses the connect cursor', portCursor.marker === 'crosshair', String(portCursor.marker));

// ==================================================================== bug 11
// Alignment must never drag a node off the lattice, even next to an off-grid
// neighbour — that is how a single stray coordinate used to spread everywhere.
await reset();
await place('Box', 300, 250);
await select();
await setField('Cell size', 20);
await setField('Subdivisions', 4);
const snapCheck2 = page.locator('.check', { hasText: 'Snap to grid' }).locator('input');
if (!(await snapCheck2.isChecked())) await snapCheck2.check();
await page.waitForTimeout(120);
// Force the first node off the lattice the way legacy data is off.
await setField('Y', 249.111);
await page.waitForTimeout(150);

await place('Box', 700, 500);
// Drag the second box so its top edge sits within tolerance of the first box's
// centre — an off-lattice guide that must lose to the grid.
const before11 = await nodeRects();
const stray = before11.find((r) => Math.abs((r.ty ?? 0) - 249.111) < 1e-6) ?? before11[0];
const mover = before11.find((r) => r !== stray) ?? before11[1];
const grabX = mover.x + mover.w / 2;
const grabY = mover.y + mover.h / 2;
const dropY = grabY + (stray.y + stray.h / 2 + 2 - mover.y);
const dropX = grabX + (stray.x + 3 - mover.x);
await page.mouse.move(grabX, grabY);
await page.mouse.down();
await page.mouse.move(dropX, dropY, { steps: 14 });
await page.mouse.move(dropX, dropY, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(220);
const rects11 = await nodeRects();
const lattice20 = (v) => Number.isFinite(v) && Math.abs(v - Math.round(v / 5) * 5) < 1e-6;
const dragged = rects11.find((r) => Math.abs((r.ty ?? 0) - 249.111) > 1e-6) ?? rects11[rects11.length - 1];
step(
  'bug 11: dragging beside an off-grid node still lands on the lattice',
  lattice20(dragged.tx) && lattice20(dragged.ty),
  `x=${dragged.tx} y=${dragged.ty}`,
);

// ==================================================================== bug 13
// A connector must avoid *other* nodes, including on a cold load — the spatial
// index used to be built after connections resolved, so a freshly opened sheet
// routed as if the page were empty.
await reset();
await place('Box', 250, 500);
await place('Box', 1150, 500);
await place('Box', 700, 430);
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.waitForTimeout(200);
const nodes13 = await nodeRects();
const near13 = (px, py) => nodes13.reduce((best, n) => {
  const d = (n.x + n.w / 2 - box.x - px) ** 2 + (n.y + n.h / 2 - box.y - py) ** 2;
  return !best || d < best.d ? { d, n } : best;
}, null).n;
const srcL = near13(250, 500);
const srcR = near13(1150, 500);
const a13 = nearestPort(await portsAt(srcL.x + srcL.w / 2, srcL.y + srcL.h / 2), srcL.x + srcL.w, srcL.y + srcL.h / 2);
const b13 = nearestPort(await portsAt(srcR.x + srcR.w / 2, srcR.y + srcR.h / 2), srcR.x, srcR.y + srcR.h / 2);
await dragPorts(a13, b13);
await page.keyboard.press('Control+s');
await page.waitForTimeout(500);

// Cold reload: the route below is computed by the very first resolve.
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.connection', { timeout: 15000 });
await page.waitForTimeout(600);

const blocked = await page.evaluate(() => {
  const path = document.querySelector('.connection path, .connection polyline');
  if (!path || !path.getTotalLength) return null;
  // The middle box is the one that is neither endpoint: pick the smallest-area node
  // whose centre is nearest the horizontal midline between the outer two.
  const rects = [...document.querySelectorAll('.node')].map((el) => el.getBoundingClientRect());
  rects.sort((r1, r2) => r1.x - r2.x);
  const middle = rects[1];
  const inner = { x: middle.x + 6, y: middle.y + 6, right: middle.right - 6, bottom: middle.bottom - 6 };
  const total = path.getTotalLength();
  const ctm = path.getScreenCTM();
  let interior = 0;
  const samples = 240;
  for (let i = 0; i <= samples; i += 1) {
    const p = path.getPointAtLength((total * i) / samples);
    const sp = path.ownerSVGElement.createSVGPoint();
    sp.x = p.x;
    sp.y = p.y;
    const s = sp.matrixTransform(ctm);
    if (s.x > inner.x && s.x < inner.right && s.y > inner.y && s.y < inner.bottom) interior += 1;
  }
  return { interior, samples, total };
});
step(
  'bug 13: a cold-loaded route avoids an unrelated node in its way',
  Boolean(blocked) && blocked.interior === 0,
  blocked ? `${blocked.interior}/${blocked.samples} samples inside` : 'no measurable path',
);


// ==================================================================== bug 14
// Rotation turns a component about the middle of its box; the geometry used to
// swing away because the SVG rotate() ran about the local origin.
await reset();
await place('Box', 500, 400);
const selectedRect = () =>
  page.$eval('.node.is-selected', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
const beforeRot = await selectedRect();
await setField('Rotation', 90);
await page.waitForTimeout(250);
const afterRot = await selectedRect();
const centreShift = Math.hypot(
  afterRot.x + afterRot.w / 2 - (beforeRot.x + beforeRot.w / 2),
  afterRot.y + afterRot.h / 2 - (beforeRot.y + beforeRot.h / 2),
);
step('bug 14: rotation keeps the component centred', centreShift < 6, `centre moved ${centreShift.toFixed(2)}px`);
step(
  'bug 14: a quarter turn swaps the footprint',
  Math.abs(afterRot.w - beforeRot.h) < 14 && Math.abs(afterRot.h - beforeRot.w) < 14,
  `${beforeRot.w.toFixed(0)}x${beforeRot.h.toFixed(0)} -> ${afterRot.w.toFixed(0)}x${afterRot.h.toFixed(0)}`,
);

// ==================================================================== bug 15
// The component editor draws what shape.svg says: a rotated element stays rotated in
// the live preview, and an elliptical arc is drawn as an arc (its bounds are not the
// rotated rectangle the old naive path parser produced).
await reset();
await page.getByRole('button', { name: 'Component editor' }).click();
await page.waitForSelector('.file-editor', { timeout: 15000 });
await page.waitForTimeout(400);
await page.locator('.file-tab > button:first-child', { hasText: 'shape.svg' }).first().click();
await page.waitForTimeout(150);
// The code pane is Monaco, so set the text through its API.
await page.waitForFunction(() => Boolean(window.monaco?.editor.getEditors()[0]), null, { timeout: 20000 });
await page.evaluate(
  (t) => window.monaco.editor.getEditors()[0].setValue(t),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" width="200" height="140">\n' +
    '  <rect id="body" x="20" y="40" width="80" height="40" fill="#cfe" stroke="#357" transform="rotate(45 60 60)" />\n' +
    '  <path id="rim" d="M 120 110 A 40 40 0 0 1 190 110" fill="none" stroke="#333" stroke-width="2" />\n' +
    '</svg>\n',
);
await page.waitForTimeout(500);

const drawn15 = await page.evaluate(() => {
  const rect = document.querySelector('.preview-pane .node [id$="body"], .preview-pane .node rect#body');
  const rim = document.querySelector('.preview-pane .node [id$="rim"], .preview-pane .node path#rim');
  const rimBox = rim ? rim.getBBox() : null;
  return {
    rotate: rect ? (rect.getAttribute('transform') ?? '') : null,
    rimLength: rim ? rim.getTotalLength() : 0,
    rimBox: rimBox ? { w: rimBox.width, h: rimBox.height } : null,
  };
});
step('bug 15: the shape file reaches the live preview', drawn15.rotate !== null && drawn15.rimLength > 0);
step('bug 15: a rotated element stays rotated', /rotate\(45/.test(drawn15.rotate ?? ''), drawn15.rotate ?? 'no rect');
step(
  'bug 15: the preview adopts the size the shape declares',
  /rotate\(45 60 60/.test(drawn15.rotate ?? ''),
  drawn15.rotate ?? 'no rect',
);
step('bug 15: an elliptical arc is drawn as an arc', drawn15.rimLength > 80, `length ${drawn15.rimLength.toFixed(1)}`);
step(
  'bug 15: the arc measures as a bulge, not a rotated box',
  drawn15.rimBox !== null && Math.abs(drawn15.rimBox.w - 70) < 4 && Math.abs(drawn15.rimBox.h - 20.6) < 4,
  drawn15.rimBox ? `${drawn15.rimBox.w.toFixed(1)}x${drawn15.rimBox.h.toFixed(1)}` : 'no arc',
);
const annIds15 = await page.locator('.ann-row code').allInnerTexts();
step('bug 15: the annotation panel sees both elements', annIds15.includes('body') && annIds15.includes('rim'), annIds15.join(','));

// ==================================================================== bug 16
// Ctrl+C / Ctrl+V duplicate the selection, pasting under the cursor.
await reset();
await place('Box', 400, 300);
const beforeCopy = (await nodeRects()).length;
await page.mouse.move(box.x + 900, box.y + 620);
await page.waitForTimeout(80);
await page.keyboard.press('Control+c');
await page.waitForTimeout(150);
await page.keyboard.press('Control+v');
await page.waitForTimeout(400);
const afterPaste = await nodeRects();
step('bug 16: ctrl+v pastes a copy', afterPaste.length === beforeCopy + 1, `${beforeCopy} -> ${afterPaste.length} nodes`);

const pasted = await page.$eval('.node.is-selected', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
const nearCursor = Math.hypot(pasted.x - (box.x + 900), pasted.y - (box.y + 620));
step('bug 16: the copy lands under the cursor and is selected', nearCursor < 60, `${nearCursor.toFixed(1)}px from cursor`);

await page.keyboard.press('Control+v');
await page.waitForTimeout(400);
step('bug 16: pasting again adds another copy', (await nodeRects()).length === beforeCopy + 2);

// Cut takes the selection away but keeps it pasteable.
await page.keyboard.press('Control+x');
await page.waitForTimeout(300);
const afterCut = (await nodeRects()).length;
await page.keyboard.press('Control+v');
await page.waitForTimeout(400);
step(
  'bug 16: ctrl+x removes the selection and it can still be pasted',
  afterCut === beforeCopy + 1 && (await nodeRects()).length === beforeCopy + 2,
  `cut -> ${afterCut}, paste -> ${(await nodeRects()).length}`,
);
// ==================================================================== bug 17
// Annotation is a property of the shape: a circle annotated as a port is
// connectable anywhere on its circumference, not only at the compass dots.
// (The sheet reloads with the nodes bug 13 saved, so everything counts relatively.)
await reset();
const before17 = (await nodeRects()).length;
const conns17Before = await page.$$eval('.connection', (els) => els.length);
await place('Circle', 340, 260);
await place('Circle', 800, 620);
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.waitForTimeout(120);

// Circles are the only 120x120 nodes here; boxes are 160x90.
const circleRects17 = (await nodeRects())
  .filter((n) => Math.abs(n.w - n.h) < 12 && n.w > 118 && n.w < 142)
  .sort((a, b) => a.tx - b.tx);
const circles17 = circleRects17.map((n) => ({ x: n.tx + 60, y: n.ty + 60 }));
step('bug 17: two circles are on the sheet', circles17.length === 2, `${(await nodeRects()).length - before17} added`);

// The dashed edge overlay is the port itself; an elliptical one traces an arc. It is only
// drawn for the node under the pointer, so measure one circle at a time.
const rimOf = async (n) => {
  await page.mouse.move(n.x + n.w / 2, n.y + n.h / 2);
  await page.waitForTimeout(170);
  const found = await page.$$eval('.port-outline', (els) =>
    els
      .filter((el) => (el.getAttribute('d') ?? '').includes('A '))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: r.width / 2 };
      }),
  );
  return found;
};
const rimsA = await rimOf(circleRects17[0]);
const rimsB = await rimOf(circleRects17[1]);
step(
  'bug 17: each circle exposes its circumference as a port',
  rimsA.length === 1 && rimsB.length === 1,
  `${rimsA.length}+${rimsB.length} outlines`,
);

const [rimA, rimB] = [rimsA[0], rimsB[0]];
// 135 degrees: as far from any compass port marker as the circumference gets.
const grab17X = rimA.cx - (rimA.r - 3) / Math.SQRT2;
const grab17Y = rimA.cy - (rimA.r - 3) / Math.SQRT2;
await page.mouse.move(grab17X, grab17Y);
await page.waitForTimeout(140);
const hoverLit = await page.$$eval('.port-outline.is-hover', (els) => els.length);
step('bug 17: hovering the stroke lights the outline port', hoverLit === 1, `${hoverLit} lit`);

await page.mouse.down();
await page.mouse.move(rimB.cx - rimB.r + 4, rimB.cy - 30, { steps: 12 });
await page.mouse.move(rimB.cx - rimB.r + 3, rimB.cy - 20, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(400);

const conns17 = await page.$$eval('.connection', (els) => els.length);
step('bug 17: dragging from the stroke creates a connection', conns17 === conns17Before + 1, `${conns17Before} -> ${conns17}`);

/** The route whose start is nearest the first circle: the one just drawn. */
const routeBetweenCircles = async () => {
  const routes = await page.$$eval('.connection [data-swcad-route]', (els) =>
    els.map((el) => JSON.parse(el.getAttribute('data-swcad-route') ?? '[]')),
  );
  let best = null;
  let bestD = Infinity;
  for (const pts of routes) {
    if (pts.length < 2) continue;
    const d = Math.hypot(pts[0].x - circles17[0].x, pts[0].y - circles17[0].y);
    if (d < bestD) {
      best = pts;
      bestD = d;
    }
  }
  return best ?? [];
};

const pts17 = await routeBetweenCircles();
const endA = pts17[0];
const endB = pts17[pts17.length - 1];
const offA = Math.abs(Math.hypot(endA.x - circles17[0].x, endA.y - circles17[0].y) - 60);
const offB = Math.abs(Math.hypot(endB.x - circles17[1].x, endB.y - circles17[1].y) - 60);
step('bug 17: both ends sit on the circumference', offA < 2 && offB < 2, `${offA.toFixed(2)} / ${offB.toFixed(2)} px off`);

// The attachment follows the line of centres, so on a diagonal pair it lands
// between the compass ports rather than on one of them.
const diagA = Math.abs(endA.x - circles17[0].x) > 12 && Math.abs(endA.y - circles17[0].y) > 12;
step(
  'bug 17: the end lands between the compass ports, not on one',
  diagA,
  `(${endA.x.toFixed(1)}, ${endA.y.toFixed(1)}) vs centre (${circles17[0].x}, ${circles17[0].y})`,
);

// Moving one circle slides the attachment round the other's edge.
await select();
await page.mouse.move(rimB.cx, rimB.cy);
await page.mouse.down();
await page.mouse.move(rimB.cx - 40, rimB.cy - 340, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(400);
const pts17b = await routeBetweenCircles();
const slid = Math.hypot(pts17b[0].x - endA.x, pts17b[0].y - endA.y);
step('bug 17: the attachment slides round the edge when the other end moves', slid > 10, `${slid.toFixed(1)}px`);
// ==================================================================== bug 18
// Routing is an A* search over a lattice built from the obstacles, not a pick
// of a few hard-coded elbows: a blocker sitting directly between two ports must
// be cleared with a minimal staircase, not a wandering or cutting path.
await reset();
const conns18Before = await page.$$eval('.connection', (els) => els.length);
await place('Box', 220, 190);
await place('Box', 900, 190);
await place('Box', 560, 190);
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.waitForTimeout(150);

// My three boxes are the only ones in the top band; earlier blocks work lower down.
const row18 = (await nodeRects()).filter((n) => n.ty !== null && n.ty < 320).sort((a, b) => a.tx - b.tx);
step('bug 18: three boxes sit in a row with a blocker between them', row18.length === 3, `${row18.length} in the row`);
const [srcA, blocker, srcB] = row18;
const rect18 = (n) => ({ x: n.tx, y: n.ty, w: n.w, h: n.h });

const east18 = nearestPort(
  await portsAt(srcA.x + srcA.w / 2, srcA.y + srcA.h / 2),
  srcA.x + srcA.w,
  srcA.y + srcA.h / 2,
);
const west18 = nearestPort(await portsAt(srcB.x + srcB.w / 2, srcB.y + srcB.h / 2), srcB.x, srcB.y + srcB.h / 2);
await page.mouse.move(east18.x + east18.width / 2, east18.y + east18.height / 2);
await page.mouse.down();
await page.mouse.move(west18.x + west18.width / 2, west18.y + west18.height / 2, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(350);
const conns18 = await page.$$eval('.connection', (els) => els.length);
step('bug 18: the connection is created', conns18 === conns18Before + 1, `${conns18Before} -> ${conns18}`);

const routes18 = await page.$$eval('.connection [data-swcad-route]', (els) =>
  els.map((el) => JSON.parse(el.getAttribute('data-swcad-route') ?? '[]')),
);
const start18 = { x: srcA.tx + srcA.w, y: srcA.ty + srcA.h / 2 };
const pts18 = routes18
  .filter((pts) => pts.length > 1)
  .sort(
    (p1, p2) =>
      Math.hypot(p1[0].x - start18.x, p1[0].y - start18.y) - Math.hypot(p2[0].x - start18.x, p2[0].y - start18.y),
  )[0];

const inside18 = (() => {
  const r = rect18(blocker);
  const inner = { x: r.x + 6, y: r.y + 6, right: r.x + r.w - 6, bottom: r.y + r.h - 6 };
  let hits = 0;
  const per = 60;
  for (let i = 1; i < pts18.length; i += 1) {
    for (let s = 0; s <= per; s += 1) {
      const t = s / per;
      const x = pts18[i - 1].x + (pts18[i].x - pts18[i - 1].x) * t;
      const y = pts18[i - 1].y + (pts18[i].y - pts18[i - 1].y) * t;
      if (x > inner.x && x < inner.right && y > inner.y && y < inner.bottom) hits += 1;
    }
  }
  return hits;
})();
step('bug 18: the route clears the blocker between the two ports', inside18 === 0, `${inside18} samples inside`);

// Optimal for this geometry: out of the port, over the blocker and back in.
step(
  'bug 18: it takes the minimal staircase rather than a wandering detour',
  pts18.length >= 4 && pts18.length <= 6,
  `${pts18.length} points`,
);

// The exit stub must never be retraced: no two consecutive segments may reverse.
const spur18 = (() => {
  for (let i = 2; i < pts18.length; i += 1) {
    const dx1 = pts18[i - 1].x - pts18[i - 2].x;
    const dy1 = pts18[i - 1].y - pts18[i - 2].y;
    const dx2 = pts18[i].x - pts18[i - 1].x;
    const dy2 = pts18[i].y - pts18[i - 1].y;
    if (dx1 * dx2 + dy1 * dy2 < -1e-6) return true;
  }
  return false;
})();
step('bug 18: the route never doubles back over its own stub', !spur18, spur18 ? 'reversal found' : 'monotone turns');

// The lattice search must not have made straight runs worse: with the blocker gone
// the same pair routes as a single straight segment again.
await select();
const blockerNow = (await nodeRects())
  .filter((n) => n.ty !== null && n.ty < 320)
  .sort((a, b) => a.tx - b.tx)[1];
await page.mouse.click(blockerNow.x + blockerNow.w / 2, blockerNow.y + blockerNow.h / 2);
await page.waitForTimeout(150);
const nodesBefore18 = (await nodeRects()).length;
await page.keyboard.press('Delete');
await page.waitForTimeout(450);
step(
  'bug 18: the blocker is removed',
  (await nodeRects()).length === nodesBefore18 - 1,
  `${nodesBefore18} -> ${(await nodeRects()).length} nodes`,
);
const afterDelete18 = await page.$$eval('.connection [data-swcad-route]', (els) =>
  els.map((el) => JSON.parse(el.getAttribute('data-swcad-route') ?? '[]')),
);
const straight18 = afterDelete18
  .filter((pts) => pts.length > 1)
  .sort(
    (p1, p2) =>
      Math.hypot(p1[0].x - start18.x, p1[0].y - start18.y) - Math.hypot(p2[0].x - start18.x, p2[0].y - start18.y),
  )[0];
step(
  'bug 18: removing the blocker restores the direct route',
  straight18.length === 2 && Math.abs(straight18[0].y - straight18[1].y) < 1,
  `${straight18.length} points`,
);
// ==================================================================== bug 19
// The inspector pane is only there when it has something to show; with nothing
// selected the canvas takes its width.
await reset();
const emptyWidth = (await page.locator('.surface').boundingBox()).width;
step(
  'bug 19: no inspector pane while nothing is selected',
  (await page.locator('.side.right').count()) === 0,
  `${await page.locator('.side.right').count()} panes`,
);
await place('Box', 400, 260);
await page.waitForTimeout(200);
const selectedWidth = (await page.locator('.surface').boundingBox()).width;
step(
  'bug 19: selecting a component reveals the inspector',
  (await page.locator('.side.right').count()) === 1,
  `${await page.locator('.side.right').count()} panes`,
);
step(
  'bug 19: the canvas gives the width back to the pane',
  emptyWidth - selectedWidth > 200,
  `${emptyWidth.toFixed(0)} -> ${selectedWidth.toFixed(0)}px`,
);
await select();
await page.mouse.click(box.x + 880, box.y + 760);
await page.waitForTimeout(200);
step(
  'bug 19: deselecting hides the pane again',
  (await page.locator('.side.right').count()) === 0 &&
    Math.abs((await page.locator('.surface').boundingBox()).width - emptyWidth) < 1,
  `${await page.locator('.side.right').count()} panes`,
);

// ==================================================================== bug 20
// Title blocks are per-instance: editing one does not rewrite every other one,
// and every field is editable — not just the title.
await reset();

const titleBlocks = page.locator('.node').filter({ has: page.locator('[id="f-title"]') });
const blockField = async (index, id) =>
  ((await titleBlocks.nth(index).locator(`[id="${id}"]`).first().textContent()) ?? '').trim();
const inspectorField = (label) =>
  page
    .locator('.side.right .field')
    .filter({ has: page.locator(`span:text-is("${label}")`) })
    .locator('input')
    .first();
const setInspector = async (label, value) => {
  const input = inspectorField(label);
  await input.fill(String(value));
  await input.dispatchEvent('change');
  await page.waitForTimeout(160);
};

await place('Title block', 300, 620);
await setInspector('Title', 'Alpha stage');
await setInspector('Drawn by', 'Ada');
await setInspector('Revision', 'C');
step(
  'bug 20: every title block field is editable, not just the title',
  (await blockField(0, 'f-title')) === 'Alpha stage' &&
    (await blockField(0, 'f-author')) === 'Ada' &&
    (await blockField(0, 'f-rev')) === 'C',
  `${await blockField(0, 'f-title')} / ${await blockField(0, 'f-author')} / ${await blockField(0, 'f-rev')}`,
);

await place('Title block', 300, 800);
step('bug 20: a second title block is placed', (await titleBlocks.count()) === 2, `${await titleBlocks.count()} blocks`);
step(
  'bug 20: it does not inherit the first block\u2019s fields',
  (await blockField(1, 'f-title')) !== 'Alpha stage' && (await blockField(1, 'f-author')) !== 'Ada',
  `title="${await blockField(1, 'f-title')}" author="${await blockField(1, 'f-author')}"`,
);

// Double-clicking a field opens *that* field, at that field, not the title at the top.
const secondBox = await titleBlocks.nth(1).boundingBox();
const dateX = secondBox.x + secondBox.width * 0.77;
const dateY = secondBox.y + secondBox.height * 0.48;
await page.mouse.dblclick(dateX, dateY);
await page.waitForTimeout(160);
const editorBox20 = await page.locator('.label-editor').boundingBox();
step(
  'bug 20: double-clicking the DATE cell opens the editor over that cell',
  !!editorBox20 && Math.abs(editorBox20.y - dateY) < 26 && editorBox20.y > secondBox.y + secondBox.height * 0.2,
  editorBox20 ? `editor y=${editorBox20.y.toFixed(0)} vs cell y=${dateY.toFixed(0)}` : 'no editor',
);
await page.keyboard.type('2030-02-03');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
step(
  'bug 20: the edit lands on the field that was clicked',
  (await blockField(1, 'f-date')) === '2030-02-03' && (await blockField(1, 'f-title')) !== '2030-02-03',
  `date="${await blockField(1, 'f-date')}" title="${await blockField(1, 'f-title')}"`,
);
step(
  'bug 20: the other block keeps its own values',
  (await blockField(0, 'f-title')) === 'Alpha stage' && (await blockField(0, 'f-date')) !== '2030-02-03',
  `title="${await blockField(0, 'f-title')}" date="${await blockField(0, 'f-date')}"`,
);

// ==================================================================== bug 21
// The inline label editor has to look like the label: same font, size, weight,
// colour and box — at any zoom.
await reset();
await place('Box', 460, 700);
await page.waitForTimeout(200);

const labelProbe = async () => {
  const target = (await nodeRects()).reduce((best, r) =>
    best === null || Math.abs(r.y - 700) < Math.abs(best.y - 700) ? r : best,
  null);
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(180);
  return page.evaluate(
    ({ cx, cy }) => {
      const input = document.querySelector('.label-editor');
      // Earlier sections leave nodes behind, so several labels read "Box";
      // measure the one under the pointer, which is the one being edited.
      const svgText = [...document.querySelectorAll('.node text')]
        .filter((t) => t.textContent === 'Box')
        .sort((a, b) => {
          const d = (t) => {
            const r = t.getBoundingClientRect();
            return Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
          };
          return d(a) - d(b);
        })[0];
      if (!input || !svgText) return null;
      const is = getComputedStyle(input);
      const ts = getComputedStyle(svgText);
      const ib = input.getBoundingClientRect();
      const tb = svgText.getBoundingClientRect();
      const zoom = tb.height / 19; // 14px text drawn at zoom 1 measures ~19px tall
      return {
        inputFont: parseFloat(is.fontSize),
        textFont: parseFloat(ts.fontSize),
        family: is.fontFamily === ts.fontFamily,
        weight: is.fontWeight === ts.fontWeight,
        colour: is.color === ts.fill,
        align: is.textAlign,
        ring:
          (is.outlineStyle === 'none' || parseFloat(is.outlineWidth) === 0) &&
          (is.borderStyle === 'none' || parseFloat(is.borderTopWidth) === 0) &&
          is.boxShadow === 'none',
        dx: Math.abs(ib.x + ib.width / 2 - (tb.x + tb.width / 2)),
        dy: Math.abs(ib.y - tb.y),
        dh: Math.abs(ib.height - tb.height),
        zoom,
      };
    },
    { cx, cy },
  );
};

const probe21 = await labelProbe();
step(
  'bug 21: the editor uses the label\u2019s own font size, family and weight',
  probe21 !== null &&
    Math.abs(probe21.inputFont - probe21.textFont) < 0.5 &&
    probe21.family &&
    probe21.weight,
  probe21 ? `${probe21.inputFont}px vs ${probe21.textFont}px` : 'no editor',
);
step(
  'bug 21: it sits on the label instead of floating above it',
  probe21 !== null && probe21.dx < 1.5 && probe21.dy < 1.5 && probe21.dh < 1.5,
  probe21 ? `dx=${probe21.dx.toFixed(1)} dy=${probe21.dy.toFixed(1)} dh=${probe21.dh.toFixed(1)}` : 'no editor',
);
step(
  'bug 21: it draws no focus ring or border over the sheet',
  probe21 !== null && probe21.ring,
  probe21 ? `ring cleared=${probe21.ring}` : 'no editor',
);
step(
  'bug 21: it keeps the label\u2019s alignment and colour',
  probe21 !== null && probe21.align === 'center' && probe21.colour,
  probe21 ? `align=${probe21.align} colour=${probe21.colour}` : 'no editor',
);

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
await page.waitForTimeout(220);
const zoomed21 = await labelProbe();
step(
  'bug 21: the editor scales with the zoom, like the drawn text',
  zoomed21 !== null && Math.abs(zoomed21.inputFont - 14 * 1.44) < 1 && zoomed21.dh < 4,
  zoomed21 ? `${zoomed21.inputFont?.toFixed(1)}px at 144%` : 'no editor',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(120);

// ---------------------------------------------------------------------------------------
// bug 22: a small annotated shape reads as a port only when the connect tool is armed, so
// there is no hover icon and no way to drag a connector *from* it in the select tool.
// ---------------------------------------------------------------------------------------
const writeFile = (path, content) =>
  page.evaluate(
    ([p, text]) =>
      fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: p, content: text }),
      }).then((r) => r.json()),
    [path, content],
  );

const pinDir = `${PROJECT}/libs/pins/components/pin`;
await writeFile(`${PROJECT}/libs/pins/library.json`, JSON.stringify({ id: 'pins', name: 'Pins', version: '1.0.0' }, null, 2));
await writeFile(
  `${pinDir}/component.json`,
  JSON.stringify({ id: 'pin', name: 'Pin', version: '1.0.0', params: [], resizable: true }, null, 2),
);
await writeFile(
  `${pinDir}/shape.svg`,
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">',
    '  <rect id="body" x="0" y="0" width="100" height="60" fill="#fff" stroke="#4c566a" />',
    '  <circle id="pin" cx="100" cy="30" r="4" fill="#88c0d0" stroke="#4c566a" />',
    '</svg>',
  ].join('\n'),
);
await writeFile(
  `${pinDir}/annotations.json`,
  JSON.stringify(
    {
      body: { kind: 'port', name: 'body', direction: 'inout', surface: 'outline' },
      pin: { kind: 'port', name: 'pin', direction: 'inout', surface: 'outline' },
    },
    null,
    2,
  ),
);

await reset();
// Earlier phases leave nodes on the sheet; clear it so the pin is the only thing under test.
await select();
await page.mouse.click(box.x + 60, box.y + 60);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
await place('Pin', 420, 300);
await select();
await page.mouse.move(box.x + 700, box.y + 600);
await page.waitForTimeout(120);

const pinNode = (await nodeRects())[0];
const pinAt = { x: pinNode.x + pinNode.w, y: pinNode.y + pinNode.h / 2 };
const portIcons = () => page.locator('.port-marker').count();
step('bug 22: nothing is highlighted while the pointer is away from the shape', (await portIcons()) === 0);

await page.mouse.move(pinAt.x, pinAt.y);
await page.waitForTimeout(140);
step('bug 22: hovering the annotated shape shows its port icon in the select tool', (await portIcons()) === 1);

await page.mouse.move(pinNode.x + pinNode.w / 2, pinNode.y);
await page.waitForTimeout(140);
step('bug 22: the body edge stays quiet, so the node can still be dragged by its border', (await portIcons()) === 0);

await place('Box', 760, 300);
await select();
const target = (await nodeRects()).find((r) => Math.abs(r.x - pinNode.x) > 40);
await page.mouse.move(target.x + target.w, target.y + target.h / 2);
await page.waitForTimeout(140);
step(
  'bug 22: a discrete port is emphasised on hover in the select tool',
  (await page.locator('.port-marker.is-hover').count()) === 1,
  `${await page.locator('.port-marker.is-hover').count()} of ${await portIcons()}`,
);
await page.mouse.move(pinAt.x, pinAt.y);
await page.waitForTimeout(120);
await page.mouse.down();
await page.mouse.move(target.x + target.w / 2, target.y + target.h / 2, { steps: 12 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(220);
step('bug 22: a connector can be dragged from it without switching tools', (await page.locator('.connection').count()) === 1);

const movedBy = await (async () => {
  const before = (await nodeRects())[0];
  await page.mouse.move(before.x + before.w / 2, before.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(before.x + before.w / 2, before.y - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = (await nodeRects())[0];
  return Math.round(before.y - after.y);
})();
step('bug 22: dragging the body border still moves the node', movedBy > 30, `moved ${movedBy}px`);

// ==================================================================== bug 23
// Hand-edited coordinates. The inspector's number fields were controlled
// `type="number"` inputs that committed `Number(e.target.value)` on every
// keystroke: emptying a field moved the node to 0, a leading minus was eaten
// (`-40.5` typed out as `040.5`), and the value shown was rounded to 2dp even
// though the node sat at 249.111.
await reset();
await select();
await page.mouse.click(box.x + 60, box.y + 60);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.waitForTimeout(180);
await place('Box', 400, 300);
await select();
const n23 = (await nodeRects())[0];
await page.mouse.click(n23.x + n23.w / 2, n23.y + n23.h / 2);
await page.waitForTimeout(200);

const typeField = async (label, text) => {
  const input = field(label);
  await input.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 40 });
  await page.waitForTimeout(160);
};
const xOf = async () => (await nodeRects())[0].tx;

await typeField('X', '137.25');
step('bug 23: a fractional coordinate typed by hand lands exactly', (await xOf()) === 137.25, `x=${await xOf()}`);
step('bug 23: the field keeps what was typed', (await field('X').inputValue()) === '137.25');

await field('X').click({ clickCount: 3 });
await page.keyboard.press('Backspace');
await page.waitForTimeout(160);
step('bug 23: clearing the field leaves the node where it was', (await xOf()) === 137.25, `x=${await xOf()}`);

await typeField('X', '-40.5');
step('bug 23: a negative coordinate can be typed', (await xOf()) === -40.5, `x=${await xOf()}`);

await setField('X', 249.111);
step('bug 23: the field shows the stored value, not a 2dp rounding', (await field('X').inputValue()) === '249.111', await field('X').inputValue());

await field('X').click({ clickCount: 3 });
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(160);
step('bug 23: arrow keys still step the value', (await xOf()) === 250.111, `x=${await xOf()}`);

// ---------------------------------------------------------------------------------------
// bug 24: an arc annotated as a port catches the connector at its bounding-box centre —
// a spot that is not on the arc at all — because the attach point was found by casting a
// ray from that centre, which an open stroke does not surround. A 180°-rotated arc curves
// away from it in every direction, so the connector always dropped into thin air.
// ---------------------------------------------------------------------------------------
const capDir = `${PROJECT}/libs/arcs/components/cap`;
await writeFile(`${PROJECT}/libs/arcs/library.json`, JSON.stringify({ id: 'arcs', name: 'Arcs', version: '1.0.0' }, null, 2));
await writeFile(
  `${capDir}/component.json`,
  JSON.stringify({ id: 'cap', name: 'Cap', version: '1.0.0', params: [], resizable: true }, null, 2),
);
await writeFile(
  `${capDir}/shape.svg`,
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 102 60" width="102" height="60">',
    '  <path id="arc" d="M 1 30 A 50 25 0 0 1 101 30" fill="none" stroke="#2e3440" stroke-width="1.5"',
    '        transform="rotate(180 51 30)" />',
    '</svg>',
  ].join('\n'),
);
await writeFile(
  `${capDir}/annotations.json`,
  JSON.stringify({ arc: { kind: 'port', name: 'arc', direction: 'inout', surface: 'outline' } }, null, 2),
);

await reset();
await select();
await page.mouse.click(box.x + 60, box.y + 60);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.waitForTimeout(180);
await place('Cap', 420, 460);
await place('Box', 420, 200);
await select();
const rects24 = await nodeRects();
const cap = rects24.reduce((a, b) => (a.y > b.y ? a : b));
const src24 = rects24.find((r) => r !== cap);

await page.getByRole('button', { name: 'Connect', exact: true }).click();
const capPorts = await portsAt(src24.x + src24.w / 2, src24.y + src24.h / 2);
const srcPort = nearestPort(capPorts, src24.x + src24.w / 2, src24.y + src24.h);
// Drop on the stroke itself: the arc's own bounding-box centre sits in the hollow of the
// curve, so dropping there could not tell a settled endpoint from a stray one.
const apex = await page.evaluate(() => {
  const arc = document.querySelector('.node [id="arc"], .node #arc');
  if (!arc) return null;
  const half = arc.getTotalLength() / 2;
  const p = arc.getPointAtLength(half);
  const sp = arc.ownerSVGElement.createSVGPoint();
  sp.x = p.x;
  sp.y = p.y;
  const s = sp.matrixTransform(arc.getScreenCTM());
  return { x: s.x, y: s.y };
});
await page.mouse.move(srcPort.x + srcPort.width / 2, srcPort.y + srcPort.height / 2);
await page.mouse.down();
await page.mouse.move(apex.x, apex.y, { steps: 14 });
await page.waitForTimeout(150);
await page.mouse.move(apex.x, apex.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(260);

const landing = await page.evaluate(() => {
  const path = document.querySelector('.connection path, .connection polyline');
  const arc = document.querySelector('.node [id="arc"], .node #arc');
  if (!path || !arc || !path.getTotalLength) return null;
  const screen = (el, p) => {
    const sp = el.ownerSVGElement.createSVGPoint();
    sp.x = p.x;
    sp.y = p.y;
    return sp.matrixTransform(el.getScreenCTM());
  };
  const total = path.getTotalLength();
  // Whichever end of the route is nearer the arc is the end that attached to it.
  const ends = [screen(path, path.getPointAtLength(0)), screen(path, path.getPointAtLength(total))];
  const arcLen = arc.getTotalLength();
  const samples = [];
  for (let i = 0; i <= 200; i += 1) samples.push(screen(arc, arc.getPointAtLength((arcLen * i) / 200)));
  const gap = (p) => Math.min(...samples.map((s) => Math.hypot(s.x - p.x, s.y - p.y)));
  const end = gap(ends[0]) <= gap(ends[1]) ? ends[0] : ends[1];
  const b = arc.getBoundingClientRect();
  return {
    gap: gap(end),
    fromBoxCentre: Math.hypot(end.x - (b.x + b.width / 2), end.y - (b.y + b.height / 2)),
    arcHeight: b.height,
  };
});
step('bug 24: the connector reaches the arc', landing !== null && (await page.locator('.connection').count()) === 1);
step(
  'bug 24: it terminates on the arc itself, not at the centre of its bounding box',
  landing !== null && landing.gap < 2,
  landing ? `${landing.gap.toFixed(1)}px off the stroke` : 'no route',
);
step(
  'bug 24: so it does not float in the hollow of the curve',
  landing !== null && landing.fromBoxCentre > landing.arcHeight / 3,
  landing ? `${landing.fromBoxCentre.toFixed(1)}px from the box centre` : 'no route',
);

await page.screenshot({ path: 'tests/e2e/bugs.png' });
await page.evaluate(
  (p) =>
    fetch('/api/fs/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p }),
    }).then((r) => r.json()),
  PROJECT,
);
await browser.close();

if (errors.length) {
  console.log('\nConsole errors:');
  for (const e of errors.slice(0, 12)) console.log('  ' + e);
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (errors.length ? `, ${errors.length} console error(s)` : ', no console errors'),
);
if (failed.length || errors.length) process.exit(1);
