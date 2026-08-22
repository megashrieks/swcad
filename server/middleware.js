import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, resolvePackage } from './package-format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

/** Roots the API is allowed to touch. The active project root is added at open time. */
const allowedRoots = new Set([path.resolve(appRoot, 'libs'), path.resolve(appRoot, 'projects')]);

let activeProject = null;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

/**
 * Resolve a request path and assert it stays inside an allowed root.
 * Symlink escapes are rejected by comparing the realpath of the nearest existing ancestor.
 */
function resolveSafe(target) {
  if (typeof target !== 'string' || target.length === 0) throw new Error('path required');
  const abs = path.resolve(appRoot, target);
  const roots = [...allowedRoots];
  const inside = (base, p) => {
    const rel = path.relative(base, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (!roots.some((root) => inside(root, abs))) throw new Error('path outside allowed roots');

  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const real = fs.realpathSync.native(probe);
  const realAbs = probe === abs ? real : path.join(real, path.relative(probe, abs));
  if (!roots.some((root) => inside(fs.realpathSync.native(root), realAbs))) {
    throw new Error('path escapes allowed roots');
  }
  return abs;
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function listDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      path: path.relative(appRoot, path.join(dir, e.name)).split(path.sep).join('/'),
      kind: e.isDirectory() ? 'dir' : 'file',
    }));
}

async function readTree(dir, base = dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await readTree(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Load one component package. The format itself lives in `package-format.js`, which the
 * component editor also uses, so what the server serves and what the editor edits can
 * never drift apart.
 *
 * Returns the runtime definition plus every source file verbatim, so the editor can work
 * on what is actually on disk instead of reverse-engineering the compiled SVG.
 */
async function loadPackage(pkgDir, libDir) {
  const files = {};
  for (const name of await readTree(pkgDir)) {
    files[name] = await fsp.readFile(path.join(pkgDir, name), 'utf8');
  }
  const resolved = resolvePackage(files, path.basename(pkgDir));
  if (resolved.errors.length) throw new Error(resolved.errors.join('; '));

  const def = resolved.def;
  const rel = (p) => path.relative(libDir, path.join(pkgDir, p)).split(path.sep).join('/');
  const scripts = {};
  if (resolved.scriptFile && resolved.script !== null) {
    // Scripts are addressed library-relative at runtime, package-relative on disk.
    def.script = rel(resolved.scriptFile);
    scripts[def.script] = resolved.script;
  }

  return {
    def,
    scripts,
    source: {
      id: def.id,
      format: 'package',
      dir: path.relative(appRoot, pkgDir).split(path.sep).join('/'),
      files,
    },
  };
}

/** Load a whole library folder into a plain object the client can consume in one round trip. */
async function loadLibrary(libDir) {
  const manifestPath = path.join(libDir, 'library.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  const components = {};
  const scripts = {};
  const shared = {};
  const plugins = {};
  const sources = {};
  const errors = {};

  // Component packages: components/<id>/component.json.
  const componentsDir = path.join(libDir, 'components');
  let entries = [];
  try {
    entries = await fsp.readdir(componentsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(componentsDir, entry.name);
    if (!fs.existsSync(path.join(pkgDir, MANIFEST_FILE))) continue;
    const key = `components/${entry.name}`;
    try {
      const pkg = await loadPackage(pkgDir, libDir);
      components[key] = pkg.def;
      Object.assign(scripts, pkg.scripts);
      sources[pkg.def.id] = pkg.source;
    } catch (err) {
      errors[key] = String((err && err.message) || err);
    }
  }

  // Legacy single-file components, kept loadable so older projects still open.
  for (const rel of await readTree(libDir)) {
    const abs = path.join(libDir, rel);
    if (rel.endsWith('.comp.json')) {
      try {
        const def = JSON.parse(await fsp.readFile(abs, 'utf8'));
        components[rel] = def;
        sources[def.id] = { id: def.id, format: 'legacy', dir: path.dirname(path.relative(appRoot, abs)).split(path.sep).join('/'), file: path.relative(appRoot, abs).split(path.sep).join('/'), files: {} };
      } catch (err) {
        errors[rel] = String((err && err.message) || err);
      }
    } else if (rel.startsWith('scripts/')) scripts[rel] = await fsp.readFile(abs, 'utf8');
    else if (rel.startsWith('shared/')) shared[rel] = await fsp.readFile(abs, 'utf8');
    else if (rel.startsWith('plugins/') && rel.endsWith('.js')) plugins[rel] = await fsp.readFile(abs, 'utf8');
  }

  return {
    manifest,
    components: orderComponents(components, manifest.components),
    scripts,
    shared,
    plugins,
    sources,
    errors: Object.keys(errors).length ? errors : undefined,
    dir: path.relative(appRoot, libDir).split(path.sep).join('/'),
  };
}

/**
 * `library.json` may list components to fix their palette order. It is only a hint:
 * entries it does not mention still load, and entries it names that no longer exist are
 * ignored, so nothing has to be kept in sync when a component is added or deleted.
 */
function orderComponents(components, hint) {
  if (!Array.isArray(hint) || hint.length === 0) return components;
  const norm = (p) => p.replace(/^\.\//, '').replace(/\.comp\.json$/i, '').replace(/\/$/, '').toLowerCase();
  const rank = new Map(hint.map((entry, i) => [norm(String(entry)), i]));
  const keys = Object.keys(components).sort((a, b) => {
    const ra = rank.get(norm(a)) ?? Infinity;
    const rb = rank.get(norm(b)) ?? Infinity;
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
  return Object.fromEntries(keys.map((k) => [k, components[k]]));
}

async function collectLibraries(roots) {
  const libs = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const libDir = path.join(root, entry.name);
      if (!fs.existsSync(path.join(libDir, 'library.json'))) continue;
      try {
        const lib = await loadLibrary(libDir);
        lib.readOnly = path.resolve(root) === path.resolve(appRoot, 'libs');
        libs.push(lib);
      } catch (err) {
        libs.push({ dir: libDir, error: String(err && err.message) });
      }
    }
  }
  return libs;
}

/** The bundled `libs/` folder ships with the app and is never written to. */
function isBundled(abs) {
  const rel = path.relative(path.resolve(appRoot, 'libs'), abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Scaffolding templates, mirroring how plugin toolchains ship starters: each is a folder
 * of files under `templates/components/<id>` with `{{id}}` / `{{name}}` placeholders.
 * They are handed to the client verbatim so it can substitute and write them itself.
 */
async function loadTemplates() {
  const root = path.resolve(appRoot, 'templates', 'components');
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const files = {};
    for (const rel of await readTree(dir)) files[rel] = await fsp.readFile(path.join(dir, rel), 'utf8');
    let info = {};
    if (files['template.json']) {
      try {
        info = JSON.parse(files['template.json']);
      } catch {
        info = {};
      }
      delete files['template.json'];
    }
    out.push({ id: entry.name, name: info.name ?? entry.name, description: info.description ?? '', files });
  }
  return out;
}

const DEFAULT_PROJECT = {
  schemaVersion: 1,
  title: 'Untitled Project',
  author: '',
  revision: 'A',
  grid: { size: 20, subdivisions: 4, origin: { x: 0, y: 0 }, unit: 'px', visible: true, snap: true },
  page: null,
  legend: { componentRef: 'base/title-block', fields: {} },
  sheets: ['sheets/main.sheet.json'],
};

const DEFAULT_SHEET = {
  schemaVersion: 1,
  id: 'main',
  name: 'Main',
  kind: 'sheet',
  nodes: [],
  connections: [],
};

async function openProject(dirAbs, create) {
  if (!fs.existsSync(dirAbs)) {
    if (!create) throw new Error('project folder does not exist');
    await fsp.mkdir(dirAbs, { recursive: true });
  }
  allowedRoots.add(dirAbs);
  const projectFile = path.join(dirAbs, 'project.swcad.json');
  if (!fs.existsSync(projectFile)) {
    if (!create) throw new Error('not a swcad project (project.swcad.json missing)');
    await fsp.mkdir(path.join(dirAbs, 'sheets'), { recursive: true });
    await fsp.mkdir(path.join(dirAbs, 'libs'), { recursive: true });
    const meta = { ...DEFAULT_PROJECT, title: path.basename(dirAbs) };
    await fsp.writeFile(projectFile, JSON.stringify(meta, null, 2), 'utf8');
    await fsp.writeFile(
      path.join(dirAbs, 'sheets', 'main.sheet.json'),
      JSON.stringify(DEFAULT_SHEET, null, 2),
      'utf8',
    );
  }
  const project = JSON.parse(await fsp.readFile(projectFile, 'utf8'));
  const sheets = {};
  for (const rel of project.sheets ?? []) {
    const abs = path.join(dirAbs, rel);
    if (fs.existsSync(abs)) sheets[rel] = JSON.parse(await fsp.readFile(abs, 'utf8'));
  }
  const libraries = await collectLibraries([path.resolve(appRoot, 'libs'), path.join(dirAbs, 'libs')]);
  activeProject = dirAbs;
  return { root: dirAbs, project, sheets, libraries };
}

const watchers = new Set();
let watcherHandle = null;

function ensureWatcher() {
  if (watcherHandle || !activeProject) return;
  const targets = [path.resolve(appRoot, 'libs'), path.join(activeProject, 'libs')].filter((p) =>
    fs.existsSync(p),
  );
  const handles = targets.map((target) =>
    fs.watch(target, { recursive: true }, (_event, filename) => {
      const payload = `data: ${JSON.stringify({ type: 'library-change', file: filename ?? null })}\n\n`;
      for (const res of watchers) res.write(payload);
    }),
  );
  watcherHandle = { close: () => handles.forEach((h) => h.close()) };
}

export function createFsMiddleware() {
  return async function fsMiddleware(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (route === '/health') return json(res, 200, { ok: true, appRoot });

      if (route === '/project/defaults') {
        return json(res, 200, {
          home: os.homedir(),
          appRoot,
          suggested: path.join(appRoot, 'projects', 'demo'),
        });
      }

      if (route === '/project/open' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const dir = path.resolve(appRoot, body.path ?? path.join(appRoot, 'projects', 'demo'));
        const result = await openProject(dir, body.create !== false);
        ensureWatcher();
        return json(res, 200, result);
      }

      if (route === '/libraries') {
        const roots = [path.resolve(appRoot, 'libs')];
        if (activeProject) roots.push(path.join(activeProject, 'libs'));
        return json(res, 200, { libraries: await collectLibraries(roots) });
      }

      if (route === '/templates') {
        return json(res, 200, { templates: await loadTemplates() });
      }


      if (route === '/component/save' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const dir = resolveSafe(body.dir);
        if (isBundled(dir)) throw new Error('the bundled libs folder is read-only');
        const safeRel = (rel) => {
          if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) {
            throw new Error(`bad file name ${rel}`);
          }
          return path.join(dir, rel);
        };
        await fsp.mkdir(dir, { recursive: true });
        for (const [rel, text] of Object.entries(body.files ?? {})) {
          const file = safeRel(rel);
          await fsp.mkdir(path.dirname(file), { recursive: true });
          await fsp.writeFile(file, String(text ?? ''), 'utf8');
        }
        for (const rel of body.remove ?? []) await fsp.rm(safeRel(rel), { force: true });
        return json(res, 200, { ok: true, dir: path.relative(appRoot, dir).split(path.sep).join('/') });
      }

      if (route === '/fs/list') {
        const dir = resolveSafe(url.searchParams.get('path'));
        return json(res, 200, { entries: await listDir(dir) });
      }

      if (route === '/fs/read') {
        const file = resolveSafe(url.searchParams.get('path'));
        // `optional` is for files that legitimately may not exist yet, such as a sheet's
        // undo journal: a 400 there would show up as a console error on every fresh boot.
        if (url.searchParams.get('optional') === '1' && !fs.existsSync(file)) {
          return json(res, 200, { content: null, missing: true });
        }
        return json(res, 200, { content: await fsp.readFile(file, 'utf8') });
      }

      if (route === '/fs/write' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const file = resolveSafe(body.path);
        if (isBundled(file)) throw new Error('the bundled libs folder is read-only');
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, String(body.content ?? ''), 'utf8');
        return json(res, 200, { ok: true });
      }

      if (route === '/fs/mkdir' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const dir = resolveSafe(body.path);
        if (isBundled(dir)) throw new Error('the bundled libs folder is read-only');
        await fsp.mkdir(dir, { recursive: true });
        return json(res, 200, { ok: true });
      }

      if (route === '/fs/delete' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const target = resolveSafe(body.path);
        if (isBundled(target)) throw new Error('the bundled libs folder is read-only');
        await fsp.rm(target, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }

      if (route === '/watch') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        watchers.add(res);
        ensureWatcher();
        req.on('close', () => watchers.delete(res));
        return undefined;
      }

      if (next) return next();
      return fail(res, 404, `no route ${route}`);
    } catch (err) {
      return fail(res, 400, String((err && err.message) || err));
    }
  };
}
