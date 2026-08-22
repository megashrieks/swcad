import type { LibraryRegistry, PluginSource } from '../library/registry';
import { compileSandboxed } from '../script/sandbox';
import type { PluginCommand, PluginDefinition } from './types';

export interface LoadedPlugin {
  /** `libId/<file stem>`, e.g. `align/align`. */
  key: string;
  id: string;
  title: string;
  libId: string;
  path: string;
  commands: PluginCommand[];
  error: string | null;
}

function stem(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.replace(/\.js$/i, '');
}

/** Keep only the fields a command may declare, so a typo cannot reach the toolbar. */
function normaliseCommand(raw: unknown, fallbackId: string, depth = 0): PluginCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const label = typeof c.label === 'string' ? c.label : typeof c.id === 'string' ? c.id : '';
  if (!label) return null;
  const items =
    depth < 2 && Array.isArray(c.items)
      ? c.items
          .map((item, i) => normaliseCommand(item, `${fallbackId}-${i}`, depth + 1))
          .filter((item): item is PluginCommand => item !== null)
      : undefined;
  if (typeof c.run !== 'function' && (!items || items.length === 0)) return null;
  return {
    id: typeof c.id === 'string' && c.id ? c.id : fallbackId,
    label,
    hint: typeof c.hint === 'string' ? c.hint : undefined,
    icon: typeof c.icon === 'string' ? c.icon : undefined,
    run: typeof c.run === 'function' ? (c.run as PluginCommand['run']) : undefined,
    items,
    enabled: typeof c.enabled === 'function' ? (c.enabled as PluginCommand['enabled']) : undefined,
    active: typeof c.active === 'function' ? (c.active as PluginCommand['active']) : undefined,
    separator: c.separator === true,
  };
}

function compilePlugin(source: PluginSource): LoadedPlugin {
  const key = `${source.libId}/${stem(source.path)}`;
  const base: LoadedPlugin = {
    key,
    id: key,
    title: source.libName,
    libId: source.libId,
    path: source.path,
    commands: [],
    error: null,
  };
  const { module, error } = compileSandboxed<PluginDefinition>(source.source, {
    api: {},
    onLog: (level, args) => console[level === 'error' ? 'error' : 'log'](`[plugin ${key}]`, ...args),
  }, 'definePlugin');
  if (!module) return { ...base, error };
  const commands = (Array.isArray(module.commands) ? module.commands : [])
    .map((raw, i) => normaliseCommand(raw, `${key}-${i}`))
    .filter((c): c is PluginCommand => c !== null);
  return {
    ...base,
    id: typeof module.id === 'string' && module.id ? module.id : key,
    title: typeof module.title === 'string' && module.title ? module.title : source.libName,
    commands,
    error: commands.length === 0 ? 'the plugin registered no commands' : null,
  };
}

/**
 * Compiles every plugin in the loaded libraries and keeps the result until the registry
 * changes. Recompiling on the registry's revision is what makes editing a plugin file
 * show up in the toolbar without a reload — the watcher already reloads the libraries.
 */
export class PluginHost {
  private compiled: LoadedPlugin[] = [];
  private revision = -1;

  constructor(private readonly registry: LibraryRegistry) {}

  /** Every plugin, compiled or failed, in library order. */
  all(): LoadedPlugin[] {
    if (this.revision !== this.registry.revision) {
      this.compiled = this.registry.plugins().map(compilePlugin);
      this.revision = this.registry.revision;
    }
    return this.compiled;
  }

  /** The ones with something to offer. */
  usable(): LoadedPlugin[] {
    return this.all().filter((p) => p.commands.length > 0);
  }

  errors(): { key: string; message: string }[] {
    return this.all()
      .filter((p) => p.error !== null)
      .map((p) => ({ key: p.key, message: p.error as string }));
  }
}
