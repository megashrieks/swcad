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
 * Compile a component script. The script registers itself by calling
 * `defineComponent({ render, style, ports })`.
 */
export function compileScript(source: string, host: SandboxHost): CompiledScript {
  let registered: ScriptModule | null = null;
  const defineComponent = (mod: ScriptModule): void => {
    if (!mod || typeof mod !== 'object') throw new TypeError('defineComponent expects an object');
    registered = mod;
  };

  const bindings: Record<string, unknown> = {
    ...safeGlobals(host),
    ...host.api,
    defineComponent,
  };

  try {
    // Sloppy mode is required for `with`; the inner function opts back into
    // strict mode so `this` is undefined and constructor escapes are closed.
    const factory = new Function(
      '__scope',
      `with (__scope) { return (function () {\n'use strict';\n${source}\n})(); }`,
    ) as (scope: unknown) => unknown;
    const returned = factory(makeScope(bindings));
    if (!registered && returned && typeof returned === 'object') registered = returned as ScriptModule;
    if (!registered) {
      return { module: {}, source, error: 'script did not call defineComponent(...)' };
    }
    return { module: registered, source, error: null };
  } catch (err) {
    return { module: {}, source, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CallResult<T> {
  value: T | null;
  error: string | null;
  ms: number;
}

/** Invoke a script hook with error capture and a wall-clock budget warning. */
export function callHook<T>(
  fn: ((ctx: unknown) => unknown) | undefined,
  ctx: unknown,
  budgetMs: number,
): CallResult<T> {
  if (typeof fn !== 'function') return { value: null, error: null, ms: 0 };
  const started = performanceNow();
  try {
    const value = fn(ctx) as T;
    const ms = performanceNow() - started;
    return { value, error: ms > budgetMs ? `hook exceeded ${budgetMs}ms budget (${ms.toFixed(1)}ms)` : null, ms };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : String(err),
      ms: performanceNow() - started,
    };
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export type ScriptRender = VNode[] | VNode | null;
