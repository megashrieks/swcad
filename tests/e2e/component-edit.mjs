// Component packages: scaffold from a template, save the files, reopen them, edit them
// through the file editor and the annotation panel, convert a legacy component, delete.
import { chromium } from 'playwright';

const BASE = process.env.SWCAD_URL ?? 'http://localhost:5273/';
const PROJECT = `${process.cwd().replace(/\\/g, '/')}/projects/edit-${Date.now().toString(36)}`;
const URL = `${BASE}?project=${encodeURIComponent(PROJECT)}`;
const LIB = 'editlib';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('console', (msg) => {
  // Probing for a deleted file is expected to 400; that is the check, not a failure.
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const results = [];
const step = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const read = (p) =>
  page.evaluate((path) => fetch(`/api/fs/read?path=${encodeURIComponent(path)}`).then((r) => r.json()), p);
const write = (p, content) =>
  page.evaluate(
    ([path, text]) =>
      fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content: text }),
      }).then((r) => r.json()),
    [p, content],
  );

const fileNames = () => page.locator('.file-tab > button:first-child').allInnerTexts();
const openFile = async (name) => {
  await page.locator('.file-tab > button:first-child', { hasText: name }).first().click();
  await page.waitForTimeout(150);
};
// The code pane is Monaco: read and write it through its API, not the DOM.
const monacoReady = () =>
  page.waitForFunction(() => Boolean(window.monaco?.editor.getEditors()[0]), null, { timeout: 20000 });
const editor = {
  inputValue: async () => {
    await monacoReady();
    return page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  },
  fill: async (text) => {
    await monacoReady();
    await page.evaluate((t) => window.monaco.editor.getEditors()[0].setValue(t), text);
    await page.waitForTimeout(150);
  },
};
const note = () => page.locator('.side.left .row-note').first().innerText();
const cell = (name) =>
  page.locator('.lib-cell').filter({ has: page.locator('.lib-item span', { hasText: name }) }).first();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.surface', { timeout: 15000 });
const root = (await page.locator('.toolbar .path').getAttribute('title')) ?? '';

// --------------------------------------------- the sheet palette hands over to the editor
const sheetCell = cell('Box');
await sheetCell.hover();
step('the sheet palette offers an edit action', (await sheetCell.locator('.lib-action').count()) > 0);
await sheetCell.locator('.lib-action').first().click();
await page.waitForSelector('.file-editor', { timeout: 5000 });
await page.waitForTimeout(400);
step('editing from the sheet opens that component', (await note()).includes('base/box'), await note());
step('the package files are listed', (await fileNames()).includes('shape.svg'), (await fileNames()).join(','));
await openFile('shape.svg');
step('the shape is the authored svg, not a rebuild', (await editor.inputValue()).trim().startsWith('<svg'));
step('a read-only component opens as a copy', (await note()).startsWith('Copy of'), await note());
step('read-only components cannot be deleted', (await cell('Box').locator('.lib-action.danger').count()) === 0);

// The bench must show the real component, and keep showing it when the file watcher
// hot-reloads the project's libraries underneath it.
const bench = () => page.locator('.preview-pane .node').first().innerHTML();
step('the opened component previews, not a placeholder', !(await bench()).includes('missing component'));

// ------------------------------------------------------------- scaffold a new component
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.waitForTimeout(300);
const scaffolded = await fileNames();
step(
  'New scaffolds a package from the template',
  ['component.json', 'shape.svg', 'annotations.json', 'script.js'].every((f) => scaffolded.includes(f)),
  scaffolded.join(','),
);
step('a scaffold previews immediately', (await page.locator('.preview-pane .node').count()) === 1);

// The bench is a picture of the annotations: every port and anchor the component declares is
// drawn without hovering it, so you can see which element you annotated.
await page.mouse.move(20, 900);
await page.waitForTimeout(250);
const marks = {
  ports: await page.locator('.preview-pane .port-marker').count(),
  anchors: await page.locator('.preview-pane .anchor-marker').count(),
};
step(
  'annotated ports and anchors stay lit in the preview',
  marks.ports === 4 && marks.anchors === 1,
  `${marks.ports} ports / ${marks.anchors} anchors`,
);

page.once('dialog', (d) => d.accept(LIB));
await page.getByRole('button', { name: 'New library' }).click();
await page.waitForTimeout(700);

await openFile('component.json');
await editor.fill(
  JSON.stringify({ id: 'widget', name: 'Widget', version: '1.0.0', params: [], resizable: true }, null, 2),
);
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Save as new' }).click();
await page.waitForTimeout(1000);

const manifest = await read(`${root}/libs/${LIB}/components/widget/component.json`);
step('saving writes the package manifest', Boolean(manifest.content), manifest.error ?? '');
step('the manifest holds what was typed', JSON.parse(manifest.content ?? '{}').name === 'Widget');
const shapeOnDisk = await read(`${root}/libs/${LIB}/components/widget/shape.svg`);
step('the shape is written beside it', (shapeOnDisk.content ?? '').includes('<svg'), shapeOnDisk.error ?? '');
step('the editor now edits the saved component', (await note()).includes(`${LIB}/widget`), await note());
const libManifest = JSON.parse((await read(`${root}/libs/${LIB}/library.json`)).content ?? '{}');
step('a component needs no entry in library.json', libManifest.components === undefined);

// --------------------------------------------------------------------- reopen and edit
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.waitForTimeout(300);
await cell('Widget').click();
await page.waitForTimeout(500);
step('reopening a saved component loads its files', (await note()).includes(`${LIB}/widget`), await note());
step('reopening is not a fork', (await page.getByRole('button', { name: 'Save changes' }).count()) === 1);

await openFile('shape.svg');
const beforeEdit = await editor.inputValue();
await editor.fill(beforeEdit.replace('</svg>', '  <circle id="dot" cx="20" cy="20" r="6" fill="#c33" />\n</svg>'));
await page.waitForTimeout(300);
step('the annotation panel lists the new element', (await page.locator('.ann-row code', { hasText: 'dot' }).count()) === 1);

// Annotate it through the panel; the panel and annotations.json are one thing.
await page.locator('.ann-row', { has: page.locator('code', { hasText: 'dot' }) }).locator('.ann-head').click();
await page.locator('.ann-row.is-open select.input').first().selectOption('port');
await page.waitForTimeout(200);
// Annotating an element lights it up on the bench straight away — that is the feedback
// telling you the right shape got annotated.
await page.mouse.move(20, 900);
await page.waitForTimeout(220);
step(
  'annotating an element marks it in the preview at once',
  (await page.locator('.preview-pane .port-marker').count()) === 5,
  `${await page.locator('.preview-pane .port-marker').count()} markers`,
);
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(1000);

const savedShape = await read(`${root}/libs/${LIB}/components/widget/shape.svg`);
step('shape edits reach disk', (savedShape.content ?? '').includes('id="dot"'));
const savedAnn = JSON.parse((await read(`${root}/libs/${LIB}/components/widget/annotations.json`)).content ?? '{}');
step('the annotation panel writes annotations.json', savedAnn.dot?.kind === 'port', JSON.stringify(savedAnn.dot ?? null));
step('no problems are reported for the saved package', (await page.locator('.problems .error').count()) === 0);
// Saving reloads the project's libraries; the draft has to survive that, or the bench
// falls back to the "missing component" placeholder.
step('the preview survives the reload that follows a save', !(await bench()).includes('missing component'), (await bench()).slice(0, 60));

// ---------------------------------------------------- a legacy single-file component converts
await write(
  `${root}/libs/${LIB}/components/oldstyle.comp.json`,
  JSON.stringify({
    id: 'oldstyle',
    name: 'Oldstyle',
    version: '1.0.0',
    params: [],
    geometry: { type: 'svg', source: '<rect id="body" x="0" y="0" width="60" height="40" fill="#eee" />' },
    annotations: { body: { kind: 'fill_slot', name: 'body' } },
    defaultSize: { w: 60, h: 40 },
  }),
);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.surface', { timeout: 15000 });
await page.getByRole('button', { name: 'Component editor' }).click();
await page.waitForTimeout(800);
await cell('Oldstyle').click();
await page.waitForTimeout(500);
step('a legacy component still opens', (await note()).includes(`${LIB}/oldstyle`), await note());
await openFile('shape.svg');
step('its svg is carried across untouched', (await editor.inputValue()).includes('id="body"'));
await page.getByRole('button', { name: /^Save (changes|as new)$/ }).click();
await page.waitForTimeout(1000);
const converted = await read(`${root}/libs/${LIB}/components/oldstyle/component.json`);
step('saving converts it into a package', Boolean(converted.content), converted.error ?? '');

// ------------------------------------------------------------------------- delete it
page.once('dialog', (d) => d.accept());
const target = cell('Widget');
await target.hover();
await target.locator('.lib-action.danger').click();
await page.waitForTimeout(1200);
const gone = await read(`${root}/libs/${LIB}/components/widget/component.json`);
step('deleting removes the package', Boolean(gone.error), gone.error ?? 'still readable');
step('the palette drops the deleted component', (await cell('Widget').count()) === 0);

// ------------------------------------------------------------------- the monaco code pane
const langOf = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLanguageId());
await cell('Box').hover();
await cell('Box').locator('.lib-action').first().click();
await page.waitForTimeout(600);
await openFile('shape.svg');
step('shape.svg opens as xml', (await langOf()) === 'xml', await langOf());
await openFile('component.json');
step('component.json opens as json', (await langOf()) === 'json', await langOf());

await openFile('shape.svg');
const boxSvg = await editor.inputValue();
await page.locator('.file-editor').click();
await page.keyboard.press('Control+Z');
await page.waitForTimeout(250);
step(
  'undo cannot reach back into the component edited before',
  (await editor.inputValue()) === boxSvg,
  (await editor.inputValue()).slice(0, 40),
);

// --------------------------------------------------------- bundled libraries stay read-only
const guarded = await page.evaluate(
  (p) =>
    fetch('/api/fs/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p, content: 'nope' }),
    }).then((r) => r.json()),
  'libs/base/components/box/component.json',
);
step(
  'the bundled base library cannot be written through the fs api',
  Boolean(guarded.error),
  guarded.error ?? 'write allowed',
);

await page.screenshot({ path: 'tests/e2e/component-edit.png' });

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
