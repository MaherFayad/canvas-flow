/** Player-mode UI state owned by the Player (kept out of the shared ui store). */
import { create } from 'zustand';

export interface PlayControls {
  next(): void;
  back(): void;
  restart(): void;
}

export interface PlayState {
  /** Row (section) id being played on the stage, or null for the board. */
  playing: string | null;
  /** Board item key → state to show instead of the item's default (sidebar state rows, stage). */
  overrides: Record<string, string>;
  /** Set by the stage while it is open (sub-header stepper drives it). */
  controls: PlayControls | null;
  /** Pixel/perf hooks for e2e. */
  transitions: number;
}

export const usePlay = create<PlayState>()(() => ({ playing: null, overrides: {}, controls: null, transitions: 0 }));

export function setOverride(itemKey: string, state: string | null) {
  const o = { ...usePlay.getState().overrides };
  if (state === null) delete o[itemKey];
  else o[itemKey] = state;
  usePlay.setState({ overrides: o });
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __fc?: Record<string, unknown> };
  (w.__fc ??= {}).play = usePlay;
}
