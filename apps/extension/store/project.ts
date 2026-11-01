/**
 * Project store: the working FlowCanvasConfig, with undo/redo (zundo).
 * Only `config` is tracked; every action that changes it is exactly one undo step.
 */
import { create } from 'zustand';
import { temporal } from 'zundo';
import { EdgeSchema, emptyConfig, frameKey, id as newId, type Edge, type FlowCanvasConfig } from '@flowcanvas/config';
import type { ScreenDecl } from '@flowcanvas/protocol';
import { recordEdge, type RecordInput } from '@/lib/canvas/record';
import { addPathScreens, addSdkScreens } from '@/lib/canvas/discover';
import { resolvePositions, type Point } from '@/lib/canvas/layout';

export interface ProjectState {
  config: FlowCanvasConfig;
  /** Last exported / imported config: baseline for the unsaved counter and Discard. */
  saved: FlowCanvasConfig;
  /** Replace both working copy and baseline; clears history. */
  load(config: FlowCanvasConfig, saved?: FlowCanvasConfig): void;
  /** Generic tracked change (one undo step). */
  update(fn: (c: FlowCanvasConfig) => FlowCanvasConfig): void;
  importConfig(c: FlowCanvasConfig): void;
  markSaved(): void;
  discard(): void;
  moveScreen(screenId: string, pos: Point): void;
  addEdge(e: Partial<Edge> & Pick<Edge, 'from' | 'to'>): Edge;
  updateEdge(id: string, patch: (e: Edge) => Edge): void;
  deleteEdge(id: string): void;
  record(input: RecordInput): Edge | null;
  duplicateState(screenId: string, fromState: string, name: string): boolean;
  deleteFrame(screenId: string, state: string): void;
  addDiscoveredPaths(paths: string[]): void;
  addSdkScreens(decls: ScreenDecl[]): void;
}

const blank = emptyConfig('http://localhost:3000');

export const useProject = create<ProjectState>()(
  temporal(
    (set, get) => ({
      config: blank,
      saved: blank,
      load(config, saved) {
        set({ config, saved: saved ?? config });
        useProject.temporal.getState().clear();
      },
      update(fn) {
        const next = fn(get().config);
        if (next !== get().config) set({ config: next });
      },
      importConfig(c) {
        set({ config: c, saved: c });
      },
      markSaved() {
        set({ saved: get().config });
      },
      discard() {
        set({ config: get().saved });
      },
      moveScreen(screenId, pos) {
        get().update((c) => {
          const positions = resolvePositions(c);
          return {
            ...c,
            // Pin every screen's current spot so auto-layout does not reshuffle others.
            screens: c.screens.map((s) => (s.id === screenId ? { ...s, position: pos } : s.position ? s : { ...s, position: positions.get(s.id) })),
          };
        });
      },
      addEdge(partial) {
        const edge = EdgeSchema.parse({ id: newId('e'), ...partial });
        get().update((c) => ({ ...c, edges: [...c.edges, edge] }));
        return edge;
      },
      updateEdge(id, patch) {
        get().update((c) => ({ ...c, edges: c.edges.map((e) => (e.id === id ? patch(e) : e)) }));
      },
      deleteEdge(id) {
        get().update((c) => ({ ...c, edges: c.edges.filter((e) => e.id !== id) }));
      },
      record(input) {
        const r = recordEdge(get().config, input);
        if (r.config !== get().config) set({ config: r.config });
        return r.edge;
      },
      duplicateState(screenId, fromState, name) {
        const state = name.trim();
        const c = get().config;
        const s = c.screens.find((x) => x.id === screenId);
        if (!state || !s || s.states.includes(state)) return false;
        const idx = s.states.indexOf(fromState);
        const states = [...s.states];
        states.splice(idx < 0 ? states.length : idx + 1, 0, state);
        const srcMocks = c.mocks[frameKey(screenId, fromState)];
        set({
          config: {
            ...c,
            screens: c.screens.map((x) => (x.id === screenId ? { ...x, states } : x)),
            mocks: srcMocks ? { ...c.mocks, [frameKey(screenId, state)]: structuredClone(srcMocks) } : c.mocks,
          },
        });
        return true;
      },
      deleteFrame(screenId, state) {
        get().update((c) => {
          const s = c.screens.find((x) => x.id === screenId);
          if (!s) return c;
          const mocks = { ...c.mocks };
          delete mocks[frameKey(screenId, state)];
          if (s.states.length > 1) {
            return {
              ...c,
              mocks,
              screens: c.screens.map((x) => (x.id === screenId ? { ...x, states: x.states.filter((st) => st !== state) } : x)),
              edges: c.edges.filter(
                (e) => !(e.from.screen === screenId && e.from.state === state) && !(e.to.screen === screenId && e.to.state === state),
              ),
            };
          }
          return {
            ...c,
            mocks,
            screens: c.screens.filter((x) => x.id !== screenId),
            edges: c.edges.filter((e) => e.from.screen !== screenId && e.to.screen !== screenId),
          };
        });
      },
      addDiscoveredPaths(paths) {
        get().update((c) => addPathScreens(c, paths));
      },
      addSdkScreens(decls) {
        get().update((c) => addSdkScreens(c, decls));
      },
    }),
    {
      partialize: (s) => ({ config: s.config }),
      equality: (a, b) => a.config === b.config,
      limit: 200,
    },
  ),
);

export const undo = () => useProject.temporal.getState().undo();
export const redo = () => useProject.temporal.getState().redo();
