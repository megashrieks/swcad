// Ground truth for the inline label editor: compare the pixels of the drawn label with
// the pixels of the editor that covers it. Same text, same font — the ink rows should
// line up exactly.
import { chromium } from 'playwright';

const BASE = process.env.SWCAD_URL ?? 'http://localhost:5273/';
const PROJECT = `${process.cwd().replace(/\\/g, '/')}/projects/lbl-${Date.now().toString(36)}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.surface', { timeout: 15000 });
const surface = await page.locator('.surface').boundingBox();

/** Rows containing dark pixels, measured inside the page from a screenshot. */
const inkRows = async (png, clip) => {
  const b64 = png.toString('base64');
  return page.evaluate(
    async ([data, w, h]) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
      const scale = img.height / h;
      let top = null;
      let bottom = null;
      let count = 0;
      for (let y = 0; y < img.height; y += 1) {
        let dark = 0;
        for (let x = 0; x < img.width; x += 1) {
          const i = (y * img.width + x) * 4;
          if (px[i] < 120 && px[i + 1] < 120 && px[i + 2] < 120) dark += 1;
        }
        if (dark > 0) {
          if (top === null) top = y;
          bottom = y;
          count += dark;
        }
      }
      return { top: top === null ? null : top / scale, bottom: bottom === null ? null : (bottom + 1) / scale, count, w, h };
    },
    [b64, clip.width, clip.height],
  );
};

let bad = 0;
for (const zoom of [1, 2]) {
  await page.locator('.lib-item', { hasText: 'Box' }).first().click();
  await page.mouse.click(surface.x + 400, surface.y + 300);
  await page.waitForTimeout(250);
  if (zoom !== 1) {
    await page.mouse.move(surface.x + 400, surface.y + 300);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(350);
  }

  const label = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.node text')].pop();
    const r = t.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // A tall, narrow window over the glyphs only: no node border, no selection ring.
  const clip = {
    x: Math.round(label.x + label.w * 0.15),
    y: Math.round(label.y - label.h),
    width: Math.max(8, Math.round(label.w * 0.7)),
    height: Math.round(label.h * 3),
  };

  const before = await inkRows(await page.screenshot({ clip, path: `tests/e2e/lbl-${zoom}-before.png` }), clip);
  await page.mouse.dblclick(label.x + label.w / 2, label.y + label.h / 2);
  await page.waitForTimeout(400);
  // Measure the editor's own glyphs: hide the label underneath so nothing bleeds in.
  await page.evaluate(() => {
    for (const t of document.querySelectorAll('.node text')) t.style.visibility = 'hidden';
  });
  await page.waitForTimeout(120);
  const after = await inkRows(await page.screenshot({ clip, path: `tests/e2e/lbl-${zoom}-after.png` }), clip);
  const info = await page.evaluate(() => {
    const input = document.querySelector('.label-editor');
    const cs = getComputedStyle(input);
    const r = input.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = cs.font;
    const m = ctx.measureText('Hxg');
    return {
      top: r.y,
      height: r.height,
      fontSize: parseFloat(cs.fontSize),
      lineHeight: cs.lineHeight,
      ascent: m.fontBoundingBoxAscent,
      descent: m.fontBoundingBoxDescent,
    };
  });
  console.log(
    `  input top=${(info.top - clip.y).toFixed(2)} h=${info.height.toFixed(2)} font=${info.fontSize} ` +
      `lh=${info.lineHeight} A=${info.ascent.toFixed(2)} D=${info.descent.toFixed(2)} ` +
      `baselineInBox=${(after.bottom - (info.top - clip.y)).toFixed(2)}`,
  );
  await page.evaluate(() => {
    for (const t of document.querySelectorAll('.node text')) t.style.visibility = '';
  });

  const dTop = after.top - before.top;
  const dBottom = after.bottom - before.bottom;
  const ok = Math.abs(dTop) <= 0.6 && Math.abs(dBottom) <= 0.6;
  if (!ok) bad += 1;
  console.log(
    `zoom x${zoom}: drawn ink ${before.top.toFixed(2)}..${before.bottom.toFixed(2)}  ` +
      `editor ink ${after.top.toFixed(2)}..${after.bottom.toFixed(2)}  ` +
      `dTop=${dTop.toFixed(2)} dBottom=${dBottom.toFixed(2)}  ${ok ? 'ALIGNED' : 'OFF'}`,
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

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
process.exit(bad ? 1 : 0);
