/**
 * Dependency tracking for component scripts.
 *
 * Every read a script performs through `ctx` records a key. Spatial queries
 * record spatial-hash bucket keys rather than individual node ids, so a
 * graph-aware component (an arrow inspecting obstacles, say) is only
 * recomputed when something actually changes inside the region it looked at.
 */
export type DepKey = string;

export const depKeys = {
  node: (id: string): DepKey => `node:${id}`,
  nodeTransform: (id: string): DepKey => `node:${id}.transform`,
  nodeParams: (id: string): DepKey => `node:${id}.params`,
  connection: (id: string): DepKey => `conn:${id}`,
  portsOf: (id: string): DepKey => `ports:${id}`,
  bucket: (key: string): DepKey => `bucket:${key}`,
  doc: (field: string): DepKey => `doc:${field}`,
  clock: (): DepKey => 'clock:minute',
  all: (): DepKey => '*',
};

export class DependencyTracker {
  private current: Set<DepKey> | null = null;
  /** dependency key -> consumer ids */
  private reverse = new Map<DepKey, Set<string>>();
  /** consumer id -> dependency keys */
  private forward = new Map<string, Set<DepKey>>();

  /** Record `key` against the consumer currently being evaluated. */
  read(key: DepKey): void {
    this.current?.add(key);
  }

  /** Evaluate `fn` while recording every dependency it reads for `consumer`. */
  track<T>(consumer: string, fn: () => T): T {
    const previous = this.current;
    const collected = new Set<DepKey>();
    this.current = collected;
    try {
      return fn();
    } finally {
      this.current = previous;
      this.setDeps(consumer, collected);
    }
  }

  private setDeps(consumer: string, keys: Set<DepKey>): void {
    const old = this.forward.get(consumer);
    if (old) {
      for (const key of old) {
        if (keys.has(key)) continue;
        const set = this.reverse.get(key);
        if (!set) continue;
        set.delete(consumer);
        if (set.size === 0) this.reverse.delete(key);
      }
    }
    for (const key of keys) {
      let set = this.reverse.get(key);
      if (!set) {
        set = new Set();
        this.reverse.set(key, set);
      }
      set.add(consumer);
    }
    this.forward.set(consumer, keys);
  }

  /** Consumers that must be recomputed for the given changed keys. */
  consumersOf(keys: Iterable<DepKey>): Set<string> {
    const out = new Set<string>();
    for (const key of keys) {
      const set = this.reverse.get(key);
      if (set) for (const consumer of set) out.add(consumer);
    }
    const wildcard = this.reverse.get(depKeys.all());
    if (wildcard) for (const consumer of wildcard) out.add(consumer);
    return out;
  }

  depsOf(consumer: string): DepKey[] {
    return [...(this.forward.get(consumer) ?? [])];
  }

  forget(consumer: string): void {
    const keys = this.forward.get(consumer);
    if (!keys) return;
    for (const key of keys) {
      const set = this.reverse.get(key);
      if (!set) continue;
      set.delete(consumer);
      if (set.size === 0) this.reverse.delete(key);
    }
    this.forward.delete(consumer);
  }

  clear(): void {
    this.reverse.clear();
    this.forward.clear();
    this.current = null;
  }
}
