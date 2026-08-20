import type { ComponentDef, ComponentSource, LoadedLibrary } from '../model/types';
import { compileLibraries } from './compile';

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

/**
 * Components that have changed library, old ref -> new one.
 *
 * A drawing stores the ref it was made with, so moving a component would otherwise turn
 * every instance already on a sheet into an unknown part. Resolving through this table
 * costs nothing until a lookup has already failed, and a document keeps working until it
 * is next saved with the new ref.
 */
const MOVED: Record<string, string> = {
  'meta/line': 'base/line',
  'meta/arc': 'base/arc',
  'meta/ellipse': 'base/ellipse',
};

export class LibraryRegistry {
  private libs = new Map<string, LoadedLibrary>();
  private entries = new Map<string, ComponentEntry>();
  private listeners = new Set<() => void>();

  revision = 0;

  /** Components whose drawing could not be flattened, from the last load. */
  compileErrors: { ref: string; message: string }[] = [];

  private depth = 0;
  private pending = false;

  load(libraries: LoadedLibrary[]): void {
    this.batch(() => {
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
      this.changed();
      // Components that were drawn rather than typed are flattened here, once, so that
      // nothing downstream ever has to care which kind it is holding.
      this.compileErrors = compileLibraries(this);
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(ref: string): ComponentEntry | null {
    const direct = this.entries.get(ref);
    if (direct) return direct;
    const { libId, compId } = parseRef(ref);
    const found = this.entries.get(`${libId}/${compId}`);
    if (found) return found;
    const moved = MOVED[`${libId}/${compId}`];
    return (moved ? this.entries.get(moved) : undefined) ?? null;
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
    this.changed();
  }

  /**
   * Run a series of changes as one. Compiling drawn components touches every one of them,
   * and nobody wants a redraw per component.
   */
  batch(fn: () => void): void {
    this.depth += 1;
    try {
      fn();
    } finally {
      this.depth -= 1;
    }
    if (this.pending) this.changed();
  }

  private changed(): void {
    this.revision += 1;
    if (this.depth > 0) {
      this.pending = true;
      return;
    }
    this.pending = false;
    for (const fn of this.listeners) fn();
  }
}
