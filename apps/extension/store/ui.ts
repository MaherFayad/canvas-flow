/** UI state (not part of undo history). */
import { create } from 'zustand';
import { DEVICE_PRESETS, type Device } from '@flowcanvas/config';
import type { Token } from '@flowcanvas/protocol';
import type { DiscoveryReport } from '@/lib/canvas/discover';

export type FrameStatus = 'loading' | 'connected' | 'ready';

export interface UiState {
  origin: string;
  mode: 'canvas' | 'player';
  deviceId: string;
  recording: boolean;
  selectedEdge: string | null;
  selectedFrame: string | null;
  live: Set<string>;
  forced: Set<string>;
  status: Record<string, FrameStatus>;
  sdk: Record<string, boolean>;
  baseTokens: Token[] | null;
  /** `note` doubles as the progress line while running; `report` is set when a run finishes. */
  discovery: { running: boolean; done: number; total: number; note?: string; report?: DiscoveryReport } | null;
  announce: string;
  importOpen: boolean;
  tokensOpen: boolean;
  /** Token edits being previewed live, not yet added to the change set. */
  tokenDraft: Record<string, string>;
  /** Player: active step = item key ("screen:state") within a row. */
  step: { row: string; key: string } | null;
  playerZoom: number;
  discoverRun: number;
  set(p: Partial<UiState>): void;
  setStatus(key: string, s: FrameStatus): void;
  force(key: string, on: boolean): void;
}

export const useUi = create<UiState>()((set, get) => ({
  origin: '',
  mode: 'player',
  deviceId: DEVICE_PRESETS[0]!.id,
  recording: false,
  selectedEdge: null,
  selectedFrame: null,
  live: new Set(),
  forced: new Set(),
  status: {},
  sdk: {},
  baseTokens: null,
  discovery: null,
  announce: '',
  importOpen: false,
  tokensOpen: false,
  tokenDraft: {},
  step: null,
  playerZoom: 0.65,
  discoverRun: 0,
  set: (p) => set(p),
  setStatus(key, s) {
    if (get().status[key] === s) return;
    set({ status: { ...get().status, [key]: s } });
  },
  force(key, on) {
    const f = new Set(get().forced);
    if (on) f.add(key);
    else f.delete(key);
    set({ forced: f });
  },
}));

export function deviceById(devices: Device[], id: string): Device {
  return devices.find((d) => d.id === id) ?? DEVICE_PRESETS.find((d) => d.id === id) ?? DEVICE_PRESETS[0]!;
}
