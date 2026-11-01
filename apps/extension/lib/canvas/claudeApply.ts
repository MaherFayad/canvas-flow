/**
 * Applying the MCP server's messages to the project store.
 * - `config` (full sync) replaces the working copy without an undo step.
 * - `patch` (a Claude change) is exactly ONE undo step, labelled "Claude: …".
 * While linked the file is the saved copy, so `saved` follows it.
 */
import { parseConfig, type FlowCanvasConfig } from '@flowcanvas/config';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/** Config object that was current BEFORE a Claude patch → the patch label. */
const labels = new WeakMap<object, string>();
let applying = false;

/** True while a remote config/patch is being written to the store (so it is not echoed back). */
export function isApplyingRemote(): boolean {
  return applying;
}

function withRemote(fn: () => void): void {
  applying = true;
  try {
    fn();
  } finally {
    applying = false;
  }
}

export type ApplyResult = { ok: true; config: FlowCanvasConfig } | { ok: false; errors: string[] };

/** Full sync. `initial` (first config after Allow) also clears the undo history. */
export function applyRemoteConfig(raw: unknown, initial = false): ApplyResult {
  const r = parseConfig(raw);
  if (!r.ok) return r;
  withRemote(() => {
    if (initial) {
      useProject.getState().load(r.config, r.config);
      return;
    }
    const t = useProject.temporal.getState();
    t.pause();
    try {
      useProject.setState({ config: r.config, saved: r.config });
    } finally {
      t.resume();
    }
  });
  // The file is the source of truth while linked: if it has no screens, an
  // earlier "Discovered N screens" note from a local crawl no longer applies.
  if (!r.config.screens.length) {
    const d = useUi.getState().discovery;
    if (d && !d.running) useUi.getState().set({ discovery: null });
  }
  return r;
}

/** One Claude change = one undo step. Returns the ids of items that changed. */
export function applyPatch(label: string, raw: unknown): ApplyResult & { changed?: string[] } {
  const r = parseConfig(raw);
  if (!r.ok) return r;
  const prev = useProject.getState().config;
  const changed = changedIds(prev, r.config);
  withRemote(() => {
    useProject.setState({ config: r.config, saved: r.config });
  });
  labels.set(prev, label.startsWith('Claude:') ? label : `Claude: ${label}`);
  return { ...r, changed };
}

/** Label of the step Undo would revert, e.g. "Claude: add edge e-1a2b3c", or null for a canvas edit. */
export function undoLabel(): string | null {
  const past = useProject.temporal.getState().pastStates;
  const top = past[past.length - 1] as { config?: object } | undefined;
  return top?.config ? (labels.get(top.config) ?? null) : null;
}

type WithId = { id: string };
const LISTS = ['screens', 'edges', 'sections', 'images', 'notes', 'comments'] as const;

/** Ids of screens, edges, sections, images, notes and comments that are new or changed (plus "tokens"). */
export function changedIds(prev: FlowCanvasConfig, next: FlowCanvasConfig): string[] {
  const out: string[] = [];
  for (const k of LISTS) {
    const before = new Map((prev[k] as WithId[]).map((x) => [x.id, JSON.stringify(x)]));
    for (const x of next[k] as WithId[]) if (before.get(x.id) !== JSON.stringify(x)) out.push(x.id);
  }
  if (JSON.stringify(prev.tokens) !== JSON.stringify(next.tokens)) out.push('tokens');
  return out;
}
