import { api, type ComponentTemplate } from '@core/io/client';
import type { ComponentEntry, LibraryRegistry } from '@core/library/registry';
import type { LoadedLibrary, SwDocument } from '@core/model/types';
import { packageFromDefinition, type PackageFiles } from '../../server/package-format.js';
import { showConfirm } from '../ui/Dialog';

/** Where a component package lives inside its library. */
export const packageDir = (lib: LoadedLibrary, id: string): string => `${lib.dir}/components/${id}`;

/**
 * The files that make up a component, exactly as the server read them. Legacy
 * single-file components have no package on disk, so one is built from the definition —
 * the SVG is copied across verbatim, never reverse-engineered.
 */
export function filesFor(entry: ComponentEntry): PackageFiles {
  if (entry.source?.format === 'package') return { ...entry.source.files };
  return packageFromDefinition(entry.def, entry.scriptSource);
}

/** True when the component is still a pre-package `.comp.json` and needs converting. */
export const isLegacy = (entry: ComponentEntry): boolean => entry.source?.format !== 'package';

/** Fill a template's `{{id}}` / `{{name}}` placeholders. */
export function scaffold(template: ComponentTemplate, vars: { id: string; name: string }): PackageFiles {
  const files: PackageFiles = {};
  for (const [path, text] of Object.entries(template.files)) {
    files[path] = text.replace(/\{\{\s*(id|name)\s*\}\}/g, (_, key: 'id' | 'name') => vars[key]);
  }
  return files;
}

/** Write a package to disk. `remove` drops files the author deleted in the editor. */
export async function writePackage(dir: string, files: PackageFiles, remove: string[] = []): Promise<void> {
  await api.saveComponent(dir, files, remove);
}

/**
 * Remove a component from disk: its package folder, or — for legacy components — the
 * definition file and its script. Read-only libraries are refused so the bundled base
 * library stays intact.
 */
export async function deleteComponent(entry: ComponentEntry, lib: LoadedLibrary): Promise<void> {
  if (lib.readOnly) throw new Error(`${lib.manifest.id} is read-only`);
  if (entry.source?.format === 'package') {
    await api.remove(entry.source.dir);
    return;
  }
  if (entry.source?.file) await api.remove(entry.source.file);
  if (entry.def.script) await api.remove(`${lib.dir}/${entry.def.script}`);
}

/** Instances of a component on a sheet, so deleting one can warn about what it breaks. */
export function usageCount(doc: SwDocument, ref: string): number {
  const matches = (r: string): boolean => r === ref || r.split('@')[0] === ref;
  let n = 0;
  for (const node of Object.values(doc.nodes)) if (matches(node.componentRef)) n += 1;
  for (const conn of Object.values(doc.connections)) if (matches(conn.componentRef)) n += 1;
  return n;
}

/**
 * Ask before deleting, warning about instances still on the sheet, then remove the
 * component from disk. Returns true when something was deleted, so the caller knows to
 * reload its libraries.
 */
export async function confirmAndDelete(
  registry: LibraryRegistry,
  doc: SwDocument,
  entry: ComponentEntry,
): Promise<boolean> {
  const lib = registry.library(entry.libId);
  if (!lib) throw new Error(`unknown library ${entry.libId}`);
  if (lib.readOnly) throw new Error(`${entry.libId} is read-only`);
  const used = usageCount(doc, entry.ref);
  const warning = used > 0 ? `\n\n${used} instance(s) on the current sheet will break.` : '';
  const ok = await showConfirm(`Delete ${entry.def.name} (${entry.ref}) from disk?${warning}`, {
    title: 'Delete component',
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return false;
  await deleteComponent(entry, lib);
  return true;
}

/** Create an empty library folder in the project. */
export async function createLibrary(root: string, id: string, name = id): Promise<void> {
  await api.mkdir(`${root}/libs/${id}/components`);
  await api.writeFile(
    `${root}/libs/${id}/library.json`,
    `${JSON.stringify({ id, name, version: '1.0.0' }, null, 2)}\n`,
  );
}
