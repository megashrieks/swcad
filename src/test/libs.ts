import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_FILE, resolvePackage } from '../../server/package-format.js';
import type { ComponentDef, ComponentSource, LoadedLibrary } from '../core/model/types';

const LIBS = path.resolve(__dirname, '../../libs');

/**
 * Load a library folder from disk the way the dev server does, so tests run against the
 * real base library instead of a hand-maintained copy of it.
 */
export function loadLibraryFromDisk(libDir: string, readOnly = true): LoadedLibrary {
  const manifest = JSON.parse(fs.readFileSync(path.join(libDir, 'library.json'), 'utf8'));
  const components: Record<string, ComponentDef> = {};
  const scripts: Record<string, string> = {};
  const shared: Record<string, string> = {};
  const sources: Record<string, ComponentSource> = {};

  const componentsDir = path.join(libDir, 'components');
  const entries = fs.existsSync(componentsDir) ? fs.readdirSync(componentsDir, { withFileTypes: true }) : [];
  for (const entry of entries) {
    const pkgDir = path.join(componentsDir, entry.name);
    if (!entry.isDirectory() || !fs.existsSync(path.join(pkgDir, MANIFEST_FILE))) continue;
    const files: Record<string, string> = {};
    for (const file of fs.readdirSync(pkgDir)) files[file] = fs.readFileSync(path.join(pkgDir, file), 'utf8');
    const resolved = resolvePackage(files, entry.name);
    if (resolved.errors.length) throw new Error(`${pkgDir}: ${resolved.errors.join('; ')}`);
    if (resolved.scriptFile && resolved.script !== null) {
      resolved.def.script = `components/${entry.name}/${resolved.scriptFile}`;
      scripts[resolved.def.script] = resolved.script;
    }
    components[`components/${entry.name}`] = resolved.def;
    sources[resolved.def.id] = {
      id: resolved.def.id,
      format: 'package',
      dir: `libs/${path.basename(libDir)}/components/${entry.name}`,
      files,
    };
  }

  const sharedDir = path.join(libDir, 'shared');
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir)) {
      shared[`shared/${file}`] = fs.readFileSync(path.join(sharedDir, file), 'utf8');
    }
  }

  return { manifest, components, scripts, shared, sources, dir: `libs/${path.basename(libDir)}`, readOnly };
}

export const loadBaseLibrary = (): LoadedLibrary => loadLibraryFromDisk(path.join(LIBS, 'base'));
