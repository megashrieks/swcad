// One-off: convert libs/<lib>/components/*.comp.json into component packages.
// Usage: node tools/migrate-packages.mjs [libDir]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { formatJson, packageFromDefinition } from '../server/package-format.js';

const libDir = path.resolve(process.argv[2] ?? 'libs/base');
const compDir = path.join(libDir, 'components');

const files = (await fsp.readdir(compDir)).filter((f) => f.endsWith('.comp.json'));
const order = [];
for (const file of files) {
  const def = JSON.parse(await fsp.readFile(path.join(compDir, file), 'utf8'));
  const scriptPath = def.script ? path.join(libDir, def.script) : null;
  // Several components can share one script file, so read it rather than moving it.
  const script = scriptPath && fs.existsSync(scriptPath) ? await fsp.readFile(scriptPath, 'utf8') : '';

  const pkg = path.join(compDir, def.id);
  await fsp.mkdir(pkg, { recursive: true });
  for (const [name, content] of Object.entries(packageFromDefinition(def, script))) {
    await fsp.writeFile(path.join(pkg, name), content, 'utf8');
  }
  await fsp.rm(path.join(compDir, file));
  order.push(`components/${def.id}`);
  console.log(`packaged ${def.id}`);
}

// `components` is only an ordering hint now; keep the order the library already had.
const manifestPath = path.join(libDir, 'library.json');
const lib = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const rank = (entry) => {
  const i = (lib.components ?? []).findIndex((c) => c.replace(/^\.\//, '').replace(/\.comp\.json$/, '') === entry);
  return i === -1 ? Infinity : i;
};
lib.components = order.sort((a, b) => rank(a) - rank(b));
await fsp.writeFile(manifestPath, `${formatJson(lib)}\n`, 'utf8');

const scriptsDir = path.join(libDir, 'scripts');
if (fs.existsSync(scriptsDir)) await fsp.rm(scriptsDir, { recursive: true, force: true });
console.log('done');
