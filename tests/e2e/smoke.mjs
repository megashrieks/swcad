// Headless smoke test: boots the app, places components, connects them, and
// checks that the graph resolves without console errors.
import { chromium } from 'playwright';

const BASE = process.env.SWCAD_URL ?? 'http://localhost:5273/';
// Each run gets a throw-away project so the flow is hermetic.
const PROJECT = `${process.cwd().replace(/\\/g, '/')}/projects/smoke-${Date.now().toString(36)}`;
const URL = `${BASE}?project=${encodeURIComponent(PROJECT)}`;

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const results = [];
const step = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.surface', { timeout: 15000 });
step('app boots', true);

const libItems = await page.locator('.lib-item').count();
step('library palette populated', libItems >= 6, `${libItems} components`);

// The toolbar's icon buttons are clustered into labelled segmented groups.
const groups = await page.$$eval('.btn-group', (gs) =>
  gs.map((g) => {
    const kids = [...g.children].map((c) => c.getBoundingClientRect());
    return {
      label: g.getAttribute('aria-label'),
      role: g.getAttribute('role'),
      size: kids.length,
      // Neighbours collapse their shared 1px border, and every member is the same height.
      joined: kids.every((k, i) => i === 0 || Math.abs(k.x - (kids[i - 1].x + kids[i - 1].width - 1)) < 0.6),
      level: kids.every((k) => Math.abs(k.height - kids[0].height) < 0.6),
    };
  }),
);
step('toolbar buttons are grouped', groups.length >= 5, groups.map((g) => `${g.label}(${g.size})`).join(' '));
step(
  'every group is a labelled, seamless strip',
  groups.every((g) => g.label && g.role === 'group' && g.size > 1 && g.joined && g.level),
  groups.filter((g) => !(g.joined && g.level)).map((g) => g.label).join(',') || 'all aligned',
);

// The chrome wears Monokai Pro: warm charcoal panels, off-white text, saturated accents —
// while the sheet stays paper-white, because components are drawn in dark ink.
const palette = await page.evaluate(() => {
  const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
  const fg = (sel) => getComputedStyle(document.querySelector(sel)).color;
  return {
    body: bg('body'),
    panel: bg('.toolbar'),
    well: bg('.input'),
    text: fg('body'),
    active: bg('.btn.is-active'),
    onActive: fg('.btn.is-active'),
    sheet: bg('.canvas-area'),
  };
});
step(
  'the chrome uses the Monokai Pro palette',
  palette.body === 'rgb(34, 31, 34)' &&
    palette.panel === 'rgb(45, 42, 46)' &&
    palette.well === 'rgb(25, 24, 26)' &&
    palette.text === 'rgb(252, 252, 250)',
  `${palette.body} / ${palette.panel} / ${palette.text}`,
);
step(
  'an armed control is filled with the accent and reads dark on it',
  palette.active === 'rgb(120, 220, 232)' && palette.onActive === 'rgb(25, 24, 26)',
  `${palette.active} on ${palette.onActive}`,
);
step('the drawing sheet stays light under the dark chrome', palette.sheet === 'rgb(253, 253, 252)', palette.sheet);

const surface = page.locator('.surface');
const box = await surface.boundingBox();

async function place(name, x, y) {
  await page.locator('.lib-item', { hasText: name }).first().click();
  await page.mouse.click(box.x + x, box.y + y);
}

await place('Box', 300, 250);
await place('Box', 700, 480);
await place('Circle', 320, 600);
await page.waitForTimeout(150);
const nodes = await page.locator('.node').count();
step('placed 3 components', nodes === 3, `${nodes} nodes`);

// Connect the first two boxes by dragging port to port.
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.waitForTimeout(150);
const ports = page.locator('.port-marker');
await page.mouse.move(box.x + 20, box.y + 850);
await page.waitForTimeout(160);
step('ports stay hidden while the pointer is off every node', (await ports.count()) === 0);

// Ports belong to the node the pointer is inside, so hover one node at a time.
const nodeRects = () =>
  page.$$eval('.node', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
const placed = await nodeRects();
const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const portsOf = async (rect) => {
  const c = centreOf(rect);
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(160);
  const found = [];
  for (let i = 0; i < (await ports.count()); i += 1) {
    const el = ports.nth(i);
    if (((await el.getAttribute('class')) ?? '').includes('is-surface')) continue;
    found.push(await el.boundingBox());
  }
  return found;
};
const nearestOf = (list, px, py) =>
  list.reduce((best, bb) => {
    const d = (bb.x - px) ** 2 + (bb.y - py) ** 2;
    return !best || d < best.d ? { d, bb } : best;
  }, null).bb;

const portsA = await portsOf(placed[0]);
step('hovering a node reveals its own ports', portsA.length === 4, `${portsA.length} ports`);
const a = nearestOf(portsA, placed[0].x + placed[0].w, centreOf(placed[0]).y);
const portsB = await portsOf(placed[1]);
const b = nearestOf(portsB, placed[1].x, centreOf(placed[1]).y);
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
const previewVisible = (await page.locator('.connect-preview').count()) > 0;
await page.mouse.up();
await page.waitForTimeout(150);
step('connect preview shown while dragging', previewVisible);
const conns = await page.locator('.connection').count();
step('connection created', conns === 1, `${conns} connections`);

// Move a node and confirm the connector follows (route changes).
await page.getByRole('button', { name: 'Select', exact: true }).click();
const routeBefore = await page.locator('.connection path, .connection polyline').first().getAttribute('d');
await page.mouse.move(box.x + 300, box.y + 250);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 160, { steps: 10 });
const highlightWhileDragging = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')];
  return canvases.some((c) => {
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) return true;
    return false;
  });
});
await page.mouse.up();
await page.waitForTimeout(150);
const routeAfter = await page.locator('.connection path, .connection polyline').first().getAttribute('d');
step('grid/highlight canvas painting', highlightWhileDragging);
step('connector re-routes when a node moves', routeBefore !== routeAfter);

// Undo/redo.
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
const afterUndo = await page.locator('.connection path, .connection polyline').first().getAttribute('d');
step('undo restores previous route', afterUndo === routeBefore);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);

// Page + legend.
await page.locator('select.input').first().selectOption('A4').catch(() => {});
await page.waitForTimeout(200);
const hasPage = await page.locator('.page-sheet').count();
step('page frame rendered', hasPage === 1);
const hasLegend = await page.locator('.page-legend').count();
step('legend rendered on page', hasLegend === 1);
await page.screenshot({ path: 'tests/e2e/smoke-sheet.png' });

// Component editor.
await page.getByRole('button', { name: 'Component editor' }).click();
await page.waitForSelector('.file-editor');
await page.waitForTimeout(400);
const paletteItems = await page.locator('.lib-item').count();
step('project libraries mounted in the component editor', paletteItems >= 6, `${paletteItems} components`);
const tabs = await page.locator('.file-tab > button:first-child').allInnerTexts();
step('a template scaffolds a package', tabs.includes('component.json') && tabs.includes('shape.svg'), tabs.join(','));
step('the scaffold previews through the real engine', (await page.locator('.preview-pane .node').count()) === 1);
step('the annotation panel lists the shape elements', (await page.locator('.ann-row').count()) > 0);

// Save the draft into a brand new project library and confirm it lands on disk.
const libId = 'smokelib';
page.once('dialog', (d) => d.accept(libId));
await page.getByRole('button', { name: 'New library' }).click();
// Wait for the new library to become the save target rather than guessing at a delay.
await page.locator('.side.left .hint code', { hasText: `libs/${libId}/` }).first().waitFor({ timeout: 10000 });
await page.locator('.file-tab > button:first-child', { hasText: 'component.json' }).first().click();
// The code pane is Monaco, so go through its API rather than the DOM.
await page.waitForFunction(() => Boolean(window.monaco?.editor.getEditors()[0]), null, { timeout: 20000 });
const manifestText = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
step('the code pane is a monaco editor', (await page.locator('.file-editor .monaco-editor').count()) === 1);
step('monaco opens the manifest as json', manifestText.trim().startsWith('{'), manifestText.slice(0, 20));
await page.evaluate(
  (t) => window.monaco.editor.getEditors()[0].setValue(t),
  manifestText.replace(/"id":\s*"[^"]*"/, '"id": "smoke-part"'),
);
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Save (as new|changes)$/ }).click();
await page.waitForTimeout(1200);
const savedMsg = await page.locator('.side.left .hint').last().innerText();
step('component saved to a project library', savedMsg.startsWith('Saved'), savedMsg);

const root = (await page.locator('.toolbar .path').getAttribute('title')) ?? '';
const pkgDir = `${root}/libs/${libId}/components/smoke-part`;
const readFile = (p) =>
  page.evaluate((path) => fetch(`/api/fs/read?path=${encodeURIComponent(path)}`).then((r) => r.json()), p);
const savedManifest = await readFile(`${pkgDir}/component.json`);
step('the package manifest is written to disk', Boolean(savedManifest.content), savedManifest.error ?? '');
const savedShape = await readFile(`${pkgDir}/shape.svg`);
step('the shape is a standalone svg file', (savedShape.content ?? '').includes('<svg'), savedShape.error ?? '');
const savedAnnotations = await readFile(`${pkgDir}/annotations.json`);
step('annotations are saved beside it', (savedAnnotations.content ?? '').includes('"port"'), savedAnnotations.error ?? '');
await page.screenshot({ path: 'tests/e2e/smoke-component.png' });

// Back to the sheet: save it and confirm the document round-trips through the server.
await page.getByRole('button', { name: 'Sheet' }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Save/ }).click();
await page.waitForTimeout(600);
const sheetRead = await page.evaluate(
  (p) => fetch(`/api/fs/read?path=${encodeURIComponent(p)}`).then((r) => r.json()),
  `${root}/sheets/main.sheet.json`,
);
const sheetDoc = sheetRead.content ? JSON.parse(sheetRead.content) : null;
step(
  'sheet persisted with nodes, a connection and the page',
  sheetDoc?.nodes?.length === 3 && sheetDoc?.connections?.length === 1 && Boolean(sheetDoc?.page),
  `${sheetDoc?.nodes?.length} nodes / ${sheetDoc?.connections?.length} connections`,
);
const saveLabel = await page.getByRole('button', { name: /^Save/ }).innerText();
step('save button reports a clean document', saveLabel.trim() === 'Saved', saveLabel);

// Remove the throw-away project.
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
