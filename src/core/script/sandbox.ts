import type { VNode } from './svg';

export interface ScriptModule {
  render?: (ctx: unknown) => unknown;
  style?: (ctx: unknown) => unknown;
  ports?: (ctx: unknown) => unknown;
  bounds?: (ctx: unknown) => unknown;
  meta?: Record<string, unknown>;
}

export interface CompiledScript {
  module: ScriptModule;
  source: string;
  error: string | null;
}

export interface SandboxHost {
  /** Extra bindings exposed to the script (svg builder, geometry, route, require...). */
  api: Record<string, unknown>;
  onLog?: (level: 'log' | 'warn' | 'error', args: unknown[]) => void;
}

/**
 * Globals a component script may use. Everything else resolves to a
 * ReferenceError, so there is no path to the DOM, network, timers or storage.
 */
function safeGlobals(host: SandboxHost): Record<string, unknown> {
  const log = (level: 'log' | 'warn' | 'error') => (...args: unknown[]) => host.onLog?.(level, args);
  return {
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Symbol,
    Date,
    Error,
    TypeError,
    RangeError,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    undefined,
    NaN,
    Infinity,
    console: Object.freeze({ log: log('log'), warn: log('warn'), error: log('error'), info: log('log') }),
  };
}

const SCOPE_BLOCK = Symbol('swcad.scope');

function makeScope(bindings: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(bindings, {
    // Claim every identifier so nothing falls through to the real global object.
    has: () => true,
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (key === SCOPE_BLOCK) return true;
      if (typeof key === 'string' && key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      throw new ReferenceError(`'${String(key)}' is not available inside a component script`);
    },
    set(_target, key) {
      throw new ReferenceError(`cannot assign to '${String(key)}' inside a component script`);
    },
    deleteProperty() {
      return false;
    },
  }) as Record<string, unknown>;
}

/**
 * Compile a script that registers itself by calling a single define function —
 * `defineComponent({...})` for components, `definePlugin({...})` for plugins. A script
 * that returns an object literal instead is accepted too.
 */
export function compileSandboxed<T extends object>(
  source: string,
  host: SandboxHost,
  defineName: string,
): { module: T | null; error: string | null } {
  let registered: T | null = null;
  const define = (mod: T): void => {
    if (!mod || typeof mod !== 'object') throw new TypeError(`${defineName} expects an object`);
    registered = mod;
  };

  const bindings: Record<string, unknown> = {
    ...safeGlobals(host),
    ...host.api,
    [defineName]: define,
  };

  try {
    // Sloppy mode is required for `with`; the inner function opts back into
    // strict mode so `this` is undefined and constructor escapes are closed.
    const factory = new Function(
      '__scope',
      `with (__scope) { return (function () {\n'use strict';\n${source}\n})(); }`,
    ) as (scope: unknown) => unknown;
    const returned = factory(makeScope(bindings));
    const mod: T | null =
      registered ?? (returned && typeof returned === 'object' ? (returned as T) : null);
    if (!mod) return { module: null, error: `script did not call ${defineName}(...)` };
    return { module: mod, error: null };
  } catch (err) {
    return { module: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Compile a component script. The script registers itself by calling
 * `defineComponent({ render, style, ports })`.
 */
export function compileScript(source: string, host: SandboxHost): CompiledScript {
  const { module, error } = compileSandboxed<ScriptModule>(source, host, 'defineComponent');
  return { module: module ?? {}, source, error };
}

export interface CallResult<T> {
  value: T | null;
  error: string | null;
  /**
   * A hook that ran to completion but overran its time budget. Its output is still
   * correct and still used, so this is reported apart from `error` — an expensive
   * generative component is slow, not broken.
   */
  warning: string | null;
  ms: number;
}

/** Invoke a script hook with error capture and a wall-clock budget warning. */
export function callHook<T>(
  fn: ((ctx: unknown) => unknown) | undefined,
  ctx: unknown,
  budgetMs: number,
): CallResult<T> {
  if (typeof fn !== 'function') return { value: null, error: null, warning: null, ms: 0 };
  const started = performanceNow();
  try {
    const value = fn(ctx) as T;
    const ms = performanceNow() - started;
    return {
      value,
      error: null,
      warning: ms > budgetMs ? `slow: ${ms.toFixed(1)}ms (budget ${budgetMs}ms)` : null,
      ms,
    };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : String(err),
      warning: null,
      ms: performanceNow() - started,
    };
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export type ScriptRender = VNode[] | VNode | null;
