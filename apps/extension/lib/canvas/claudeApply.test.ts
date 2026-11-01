import { beforeEach, describe, expect, it } from 'vitest';
import { emptyConfig, type FlowCanvasConfig } from '@flowcanvas/config';
import { redo, undo, useProject } from '@/store/project';
import { applyPatch, applyRemoteConfig, changedIds, isApplyingRemote, undoLabel } from './claudeApply';

const base = (): FlowCanvasConfig => ({
  ...emptyConfig('http://localhost:5173', 'Helka'),
  screens: [
    { id: 'welcome', title: 'Welcome', section: null, path: '/', states: ['default'] },
    { id: 'catalog', title: 'Catalog', section: null, path: '/catalog', states: ['default', 'empty'] },
  ],
});

const past = () => useProject.temporal.getState().pastStates.length;

beforeEach(() => {
  useProject.getState().load(base());
});

describe('Claude patches and full syncs', () => {
  it('a patch with several changes is ONE undo step, labelled "Claude: …"', () => {
    const before = useProject.getState().config;
    const next: FlowCanvasConfig = {
      ...structuredClone(before),
      edges: [{ id: 'e9', from: { screen: 'catalog', state: 'empty' }, to: { screen: 'catalog', state: 'default' }, trigger: { label: 'Clear filters', gesture: 'tap' }, transition: { type: 'push', duration: 240, easing: 'ease' }, kind: 'happy' }],
      notes: [{ id: 'n-1', kind: 'decision', text: 'why', attachTo: { type: 'edge', id: 'e9' }, rect: { x: 0, y: 0, w: 220, h: 120 }, section: null, author: 'claude', createdAt: '2026-11-01T10:00:00Z' }],
      tokens: { '--color-bg': '#000' },
    };
    const r = applyPatch('Claude: add edge e9', next);
    expect(r.ok).toBe(true);
    expect(r.changed?.sort()).toEqual(['e9', 'n-1', 'tokens'].sort());
    expect(past()).toBe(1);
    expect(undoLabel()).toBe('Claude: add edge e9');
    // The file is the saved copy while linked.
    expect(useProject.getState().saved).toBe(useProject.getState().config);

    undo();
    const c = useProject.getState().config;
    expect(c.edges).toHaveLength(0);
    expect(c.notes).toHaveLength(0);
    expect(c.tokens).toEqual({});
    expect(undoLabel()).toBeNull();
    redo();
    expect(useProject.getState().config.edges.map((e) => e.id)).toEqual(['e9']);
  });

  it('adds the "Claude:" prefix when the label lacks it', () => {
    applyPatch('rename section', { ...base(), sections: [{ id: 's', title: 'S' }] });
    expect(undoLabel()).toBe('Claude: rename section');
  });

  it('a canvas edit after a Claude patch is its own step with no Claude label', () => {
    applyPatch('Claude: add note', { ...base(), notes: [] , edges: [] });
    useProject.getState().update((c) => ({ ...c, project: { ...c.project, name: 'Renamed' } }));
    expect(undoLabel()).toBeNull();
    undo();
    expect(undoLabel()).toBe('Claude: add note');
  });

  it('a full sync replaces the working copy without an undo step; the first one also clears history', () => {
    useProject.getState().update((c) => ({ ...c, project: { ...c.project, name: 'Local edit' } }));
    expect(past()).toBe(1);
    const file = { ...base(), project: { name: 'From file', origin: 'http://localhost:5173' } };
    expect(applyRemoteConfig(file).ok).toBe(true);
    expect(useProject.getState().config.project.name).toBe('From file');
    expect(past()).toBe(1); // not an undo step
    expect(applyRemoteConfig(file, true).ok).toBe(true);
    expect(past()).toBe(0);
    expect(isApplyingRemote()).toBe(false);
  });

  it('rejects an invalid config and leaves the store alone', () => {
    const before = useProject.getState().config;
    const r = applyPatch('bad', { version: 2 });
    expect(r.ok).toBe(false);
    expect(useProject.getState().config).toBe(before);
    expect(past()).toBe(0);
  });

  it('changedIds lists new and changed items only', () => {
    const a = base();
    const b = structuredClone(a);
    b.screens[1]!.title = 'Catalog v2';
    b.sections.push({ id: 'sec', title: 'S', parent: null, color: 'grey', layout: 'free', collapsed: false, locked: false, order: 0 });
    expect(changedIds(a, b).sort()).toEqual(['catalog', 'sec']);
    expect(changedIds(a, a)).toEqual([]);
  });
});
