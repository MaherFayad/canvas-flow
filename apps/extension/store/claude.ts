/** Claude link UI state (not part of undo history). */
import { create } from 'zustand';
import type { ActivityRow, LinkPhase } from '@/lib/canvas/mcpLink';

export const CHANGED_MS = 3000;

export interface ConfirmAsk {
  id: string;
  action: 'delete' | 'set_tokens';
  message: string;
  resolve: (allowed: boolean) => void;
}

export interface ClaudeState {
  phase: LinkPhase;
  port: number | null;
  name: string | null;
  paused: boolean;
  /** "Claude wants to connect to …" waiting for an answer. */
  ask: { name: string; resolve: (granted: boolean) => void } | null;
  confirms: ConfirmAsk[];
  activity: ActivityRow[];
  /** Item id → time it stops showing "Changed by Claude". */
  changed: Record<string, number>;
  lastError: string | null;
  set(p: Partial<ClaudeState>): void;
  markChanged(ids: string[]): void;
}

export const useClaude = create<ClaudeState>()((set, get) => ({
  phase: 'off',
  port: null,
  name: null,
  paused: false,
  ask: null,
  confirms: [],
  activity: [],
  changed: {},
  lastError: null,
  set: (p) => set(p),
  markChanged(ids) {
    if (!ids.length) return;
    const until = Date.now() + CHANGED_MS;
    const changed = { ...get().changed };
    for (const id of ids) changed[id] = until;
    set({ changed });
    setTimeout(() => {
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(get().changed).filter(([, t]) => t > now));
      set({ changed: next });
    }, CHANGED_MS + 20);
  },
}));

/** True while the canvas is linked and Claude is allowed. */
export const isLinked = (s: Pick<ClaudeState, 'phase'>) => s.phase === 'linked';
