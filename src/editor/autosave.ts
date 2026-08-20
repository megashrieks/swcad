export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions {
  /** Performs the write. Rejections are surfaced as `error` and retried. */
  save: () => Promise<void>;
  /** Quiet time after the last edit before a save goes out. */
  idleDelay?: number;
  /** Longest a change may sit unsaved while edits keep arriving. */
  maxDelay?: number;
  /** Wait before retrying a failed save. */
  retryDelay?: number;
  /** Postpone the write while this is true, e.g. mid-drag. */
  defer?: () => boolean;
  onStatus?: (status: SaveStatus, error: string | null) => void;
}

/**
 * Debounced writer behind the editor's auto-save.
 *
 * Edits arrive in bursts — a drag emits a change per pointer move — so a save goes out
 * once the burst stops (`idleDelay`), with `maxDelay` as a backstop so a long continuous
 * gesture still gets checkpointed. Saves never overlap: a change made while a write is in
 * flight schedules the next one instead of racing it.
 */
export class Autosave {
  private readonly idleDelay: number;
  private readonly maxDelay: number;
  private readonly retryDelay: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private dirtySince = 0;
  private running: Promise<void> | null = null;
  private disposed = false;

  status: SaveStatus = 'saved';
  error: string | null = null;

  constructor(private readonly options: AutosaveOptions) {
    this.idleDelay = options.idleDelay ?? 700;
    this.maxDelay = options.maxDelay ?? 4000;
    this.retryDelay = options.retryDelay ?? 3000;
  }

  /** True when there is work the next save would write. */
  get pending(): boolean {
    return this.dirty;
  }

  /** Note that the document changed; the save itself is scheduled. */
  markDirty(): void {
    if (this.disposed) return;
    if (!this.dirty) {
      this.dirty = true;
      this.dirtySince = Date.now();
    }
    // A write in flight reschedules itself when it lands, and a failed one is already
    // waiting on its retry — neither wants an edit to pull the next attempt forward.
    if (this.status === 'saving') return;
    if (this.status === 'error') {
      if (this.timer === null) this.schedule(this.retryDelay);
      return;
    }
    this.setStatus('pending', null);
    this.schedule(this.wait());
  }

  /** Save now, waiting for any write already in flight. Ctrl+S and the Save button use this. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.running) await this.running;
    if (this.disposed || !this.dirty) return;
    await this.run(true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /**
   * Re-arms a disposed scheduler. React's development double-mount tears an effect down
   * and sets it up again around the same instance, which would otherwise silence
   * auto-save for the rest of the session.
   */
  resume(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.dirty) this.schedule(this.wait());
  }

  /** Called when a save succeeded elsewhere, so nothing is outstanding. */
  reset(): void {
    this.dirty = false;
    this.clearTimer();
    this.setStatus('saved', null);
  }

  private wait(): number {
    const deadline = this.dirtySince + this.maxDelay - Date.now();
    return Math.max(0, Math.min(this.idleDelay, deadline));
  }

  private schedule(ms: number): void {
    this.clearTimer();
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(false);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: SaveStatus, error: string | null): void {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.options.onStatus?.(status, error);
  }

  private async run(force: boolean): Promise<void> {
    if (this.disposed || !this.dirty) return;
    if (this.running) return;
    if (!force && this.options.defer?.()) {
      this.schedule(this.idleDelay);
      return;
    }
    this.clearTimer();
    this.dirty = false;
    this.setStatus('saving', null);
    const task = this.write();
    this.running = task;
    try {
      await task;
    } finally {
      if (this.running === task) this.running = null;
    }
  }

  private async write(): Promise<void> {
    try {
      await this.options.save();
      if (this.disposed) return;
      if (this.dirty) {
        this.setStatus('pending', null);
        this.schedule(this.idleDelay);
      } else {
        this.setStatus('saved', null);
      }
    } catch (err) {
      // The document is still unsaved, so keep it queued and let the retry pick it up.
      this.dirty = true;
      if (this.disposed) return;
      this.setStatus('error', err instanceof Error ? err.message : String(err));
      this.schedule(this.retryDelay);
    }
  }
}
