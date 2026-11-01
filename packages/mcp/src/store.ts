/**
 * ProjectStore: the project's flowcanvas.config.json as the single source of truth.
 * Atomic, validated writes; chokidar watch for outside edits; change events.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'chokidar';
import {
  CONFIG_FILE,
  emptyConfig,
  parseConfig,
  serializeConfig,
  type FlowCanvasConfig,
} from '@flowcanvas/config';
import { ToolError, silentLogger, type Logger } from './log.js';

export const DEFAULT_ORIGIN = 'http://localhost:5173';

export type ChangeSource = 'claude' | 'canvas' | 'external';

export interface StoreChange {
  source: ChangeSource;
  /** Short human summary, e.g. "add edge e-1a2b3c". */
  label: string;
  config: FlowCanvasConfig;
  prev: FlowCanvasConfig;
}

export interface ProjectStoreOptions {
  projectDir: string;
  /** Origin used when the config file does not exist yet. */
  origin?: string;
  log?: Logger;
  /** Debounce for watcher events, ms. */
  watchDebounceMs?: number;
}

export class ValidationError extends ToolError {
  constructor(errors: string[], prefix = 'The change was rejected because the config would be invalid') {
    super(`${prefix}:\n- ${errors.join('\n- ')}`, errors);
    this.name = 'ValidationError';
  }
}

export class ProjectStore extends EventEmitter {
  readonly dir: string;
  readonly file: string;
  readonly defaultOrigin: string;
  private readonly log: Logger;
  private readonly debounceMs: number;
  private config: FlowCanvasConfig | null = null;
  private diskErrors: string[] | null = null;
  private lastOwnWrite: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private rereadTimer: NodeJS.Timeout | null = null;

  constructor(opts: ProjectStoreOptions) {
    super();
    this.dir = path.resolve(opts.projectDir);
    this.file = path.join(this.dir, CONFIG_FILE);
    this.defaultOrigin = opts.origin ?? DEFAULT_ORIGIN;
    this.log = opts.log ?? silentLogger;
    this.debounceMs = opts.watchDebounceMs ?? 60;
  }

  /** Read the file once. A missing file is fine (an empty config is used until the first write). */
  async load(): Promise<void> {
    const text = await this.readFile();
    if (text === null) {
      this.config = null;
      this.diskErrors = null;
      return;
    }
    const r = parseText(text);
    if (r.ok) {
      this.config = r.config;
      this.diskErrors = null;
    } else {
      this.config = null;
      this.diskErrors = r.errors;
      this.log.warn(`${CONFIG_FILE} is invalid: ${r.errors.join('; ')}`);
    }
  }

  /** True when flowcanvas.config.json exists and was read. */
  get onDisk(): boolean {
    return this.config !== null;
  }

  /** Current config. Throws a ToolError when the file on disk is invalid. */
  get(): FlowCanvasConfig {
    if (this.diskErrors) {
      throw new ValidationError(
        this.diskErrors,
        `${CONFIG_FILE} on disk is invalid (it was edited outside Flow Canvas). Fix the file, then try again`,
      );
    }
    return this.config ?? emptyConfig(this.defaultOrigin, path.basename(this.dir) || 'Flow Canvas project');
  }

  /**
   * Apply a change to a copy of the config, validate it, write the file atomically,
   * then emit `change`. Calls are serialized.
   */
  mutate<T>(label: string, fn: (draft: FlowCanvasConfig) => T, source: ChangeSource = 'claude'): Promise<{ config: FlowCanvasConfig; result: T }> {
    return this.enqueue(async () => {
      const prev = this.get();
      const draft = structuredClone(prev);
      const result = fn(draft);
      const config = await this.commit(draft, prev, source, label);
      return { config, result };
    });
  }

  /** Replace the whole config (canvas edits). Validated like any write. */
  replace(raw: unknown, source: ChangeSource, label: string): Promise<FlowCanvasConfig> {
    return this.enqueue(async () => {
      let prev: FlowCanvasConfig;
      try {
        prev = this.get();
      } catch {
        prev = emptyConfig(this.defaultOrigin);
      }
      const config = await this.commit(raw, prev, source, label);
      return config;
    });
  }

  /** Start watching the file for outside edits. */
  async watch(): Promise<void> {
    if (this.watcher) return;
    await fs.mkdir(this.dir, { recursive: true });
    const w = watch(this.dir, {
      depth: 0,
      ignoreInitial: true,
      ignored: (p: string) => {
        const abs = path.resolve(p);
        return abs !== this.dir && abs !== this.file;
      },
    });
    w.on('add', () => this.scheduleReread());
    w.on('change', () => this.scheduleReread());
    w.on('unlink', () => this.log.warn(`${CONFIG_FILE} was deleted; keeping the last config in memory until the next write`));
    w.on('error', (e) => this.log.error(`watcher: ${String(e)}`));
    await new Promise<void>((resolve) => w.once('ready', () => resolve()));
    this.watcher = w;
  }

  async close(): Promise<void> {
    if (this.rereadTimer) clearTimeout(this.rereadTimer);
    this.rereadTimer = null;
    await this.watcher?.close();
    this.watcher = null;
    await this.queue.catch(() => undefined);
  }

  /** Re-read the file now (used by the watcher; exposed for tests). */
  rereadNow(): Promise<void> {
    return this.enqueue(async () => {
      const text = await this.readFile();
      if (text === null) return;
      if (text === this.lastOwnWrite) return;
      if (this.config && text === serializeConfig(this.config)) return;
      const r = parseText(text);
      if (!r.ok) {
        this.diskErrors = r.errors;
        this.log.warn(`${CONFIG_FILE} changed outside and is invalid: ${r.errors.join('; ')}`);
        this.emit('invalid', r.errors);
        return;
      }
      const prev = this.config ?? emptyConfig(this.defaultOrigin);
      this.config = r.config;
      this.diskErrors = null;
      this.log.info(`${CONFIG_FILE} changed outside; reloaded`);
      this.emit('change', { source: 'external', label: 'file edited outside', config: r.config, prev } satisfies StoreChange);
    });
  }

  /* ------------------------------------------------------------------ */

  private scheduleReread(): void {
    if (this.rereadTimer) clearTimeout(this.rereadTimer);
    this.rereadTimer = setTimeout(() => {
      this.rereadTimer = null;
      this.rereadNow().catch((e) => this.log.error(`reread failed: ${String(e)}`));
    }, this.debounceMs);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async commit(
    candidate: unknown,
    prev: FlowCanvasConfig,
    source: ChangeSource,
    label: string,
  ): Promise<FlowCanvasConfig> {
    // Round-trip through JSON so the check sees exactly what lands on disk.
    let plain: unknown;
    try {
      plain = JSON.parse(JSON.stringify(candidate));
    } catch (e) {
      throw new ToolError(`Config is not serializable: ${String(e)}`);
    }
    const r = parseConfig(plain);
    if (!r.ok) throw new ValidationError(r.errors);
    const text = serializeConfig(r.config);
    await this.writeAtomic(text);
    this.config = r.config;
    this.diskErrors = null;
    this.emit('change', { source, label, config: r.config, prev } satisfies StoreChange);
    return r.config;
  }

  private async writeAtomic(text: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    this.lastOwnWrite = text;
    try {
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, this.file);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw new ToolError(`Could not write ${CONFIG_FILE}: ${(e as Error).message}`);
    }
  }

  private async readFile(): Promise<string | null> {
    try {
      return await fs.readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
}

function parseText(text: string): { ok: true; config: FlowCanvasConfig } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  return parseConfig(raw);
}
