import type { ComponentDef, ComponentSource, LoadedLibrary } from '../model/types';

export interface ComponentEntry {
  libId: string;
  def: ComponentDef;
  /** `libId/componentId` */
  ref: string;
  scriptSource: string | null;
  readOnly: boolean;
  /** Library folder relative to the app root, e.g. `libs/base`. */
  libDir: string;
  /** The files this component is made of, straight from disk. */
  source: ComponentSource | null;
}

/** Parse `lib/comp` or `lib/comp@1.2.0`. */
export function parseRef(ref: string): { libId: string; compId: string; version: string | null } {
  const [base, version = null] = ref.split('@');
  const slash = base.indexOf('/');
  if (slash === -1) return { libId: 'base', compId: base, version };
  return { libId: base.slice(0, slash), compId: base.slice(slash + 1), version };
}

export class LibraryRegistry {
  private libs = new Map<string, LoadedLibrary>();
  private entries = new Map<string, ComponentEntry>();
  private listeners = new Set<() => void>();

  revision = 0;

  load(libraries: LoadedLibrary[]): void {
    this.libs.clear();
    this.entries.clear();
    for (const lib of libraries) {
      if (!lib?.manifest?.id) continue;
      this.libs.set(lib.manifest.id, lib);
      for (const [path, def] of Object.entries(lib.components ?? {})) {
        if (!def?.id) continue;
        const ref = `${lib.manifest.id}/${def.id}`;
        const scriptKey = def.script ?? null;
        this.entries.set(ref, {
          libId: lib.manifest.id,
          def,
          ref,
          scriptSource: scriptKey ? (lib.scripts?.[scriptKey] ?? null) : null,
          readOnly: Boolean(lib.readOnly),
          libDir: lib.dir,
          source: lib.sources?.[def.id] ?? null,
        });
        void path;
      }
    }
    this.revision += 1;
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(ref: string): ComponentEntry | null {
    const direct = this.entries.get(ref);
    if (direct) return direct;
    const { libId, compId } = parseRef(ref);
    return this.entries.get(`${libId}/${compId}`) ?? null;
  }

  has(ref: string): boolean {
    return this.get(ref) !== null;
  }

  all(): ComponentEntry[] {
    return [...this.entries.values()];
  }

  libraries(): LoadedLibrary[] {
    return [...this.libs.values()];
  }

  library(id: string): LoadedLibrary | null {
    return this.libs.get(id) ?? null;
  }

  /** Source of a `shared/<name>.js` module, addressed as `lib:name` from scripts. */
  sharedSource(libId: string, name: string): string | null {
    const lib = this.libs.get(libId);
    if (!lib) return null;
    const key = name.endsWith('.js') ? `shared/${name}` : `shared/${name}.js`;
    return lib.shared?.[key] ?? null;
  }

  /** Add or replace a single component definition (used by the component editor). */
  upsert(libId: string, def: ComponentDef, scriptSource: string | null): void {
    const lib = this.libs.get(libId);
    if (lib) {
      lib.components[`components/${def.id}`] = def;
      if (def.script && scriptSource !== null) lib.scripts[def.script] = scriptSource;
    }
    this.entries.set(`${libId}/${def.id}`, {
      libId,
      def,
      ref: `${libId}/${def.id}`,
      scriptSource,
      readOnly: Boolean(lib?.readOnly),
      libDir: lib?.dir ?? '',
      source: lib?.sources?.[def.id] ?? null,
    });
    this.revision += 1;
    for (const fn of this.listeners) fn();
  }
}
