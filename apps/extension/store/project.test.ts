import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema } from '@flowcanvas/config';
import { redo, undo, useProject } from './project';

const base = ConfigSchema.parse({
  version: 1,
  project: { name: 't', origin: 'http://localhost:3000' },
  screens: [
    { id: 'a', title: 'A', path: '/' },
    { id: 'b', title: 'B', path: '/b', states: ['default', 'empty'] },
  ],
  mocks: { 'b:empty': [{ match: { url: '/api/*' }, status: 200, body: [] }] },
});
const s = () => useProject.getState();
const past = () => useProject.temporal.getState().pastStates.length;

beforeEach(() => s().load(base));

describe('project store undo grouping', () => {
  it('load clears history; markSaved is not an undo step', () => {
    expect(past()).toBe(0);
    s().markSaved();
    expect(past()).toBe(0);
  });
  it('recording an edge that also creates a screen is ONE undo step', () => {
    s().record({ from: { screen: 'a', state: 'default' }, toPath: '/new-place', click: { target: 'a', text: 'Go' } });
    expect(s().config.screens).toHaveLength(3);
    expect(s().config.edges).toHaveLength(1);
    expect(past()).toBe(1);
    undo();
    expect(s().config.screens).toHaveLength(2);
    expect(s().config.edges).toHaveLength(0);
    redo();
    expect(s().config.edges).toHaveLength(1);
  });
  it('moving a screen is one step, even though other screens get pinned', () => {
    s().moveScreen('a', { x: 10, y: 20 });
    expect(past()).toBe(1);
    expect(s().config.screens.find((x) => x.id === 'a')?.position).toEqual({ x: 10, y: 20 });
    undo();
    expect(s().config.screens.every((x) => !x.position)).toBe(true);
  });
  it('duplicate as new state copies mocks and is one step', () => {
    expect(s().duplicateState('b', 'empty', 'empty-filtered')).toBe(true);
    expect(s().config.screens.find((x) => x.id === 'b')?.states).toEqual(['default', 'empty', 'empty-filtered']);
    expect(s().config.mocks['b:empty-filtered']).toHaveLength(1);
    expect(s().duplicateState('b', 'empty', 'empty')).toBe(false);
    expect(past()).toBe(1);
  });
  it('edge edits and discard are undoable; no-op updates add nothing', () => {
    const e = s().addEdge({ from: { screen: 'a', state: 'default' }, to: { screen: 'b', state: 'default' } });
    s().updateEdge(e.id, (x) => ({ ...x, kind: 'error' }));
    s().update((c) => c);
    expect(past()).toBe(2);
    s().discard();
    expect(s().config.edges).toHaveLength(0);
    undo();
    expect(s().config.edges[0]?.kind).toBe('error');
  });
  it('deleting the only state deletes the screen and its edges', () => {
    s().addEdge({ from: { screen: 'a', state: 'default' }, to: { screen: 'b', state: 'empty' } });
    s().deleteFrame('b', 'empty');
    expect(s().config.edges).toHaveLength(0);
    expect(s().config.mocks['b:empty']).toBeUndefined();
    s().deleteFrame('a', 'default');
    expect(s().config.screens.map((x) => x.id)).toEqual(['b']);
  });
});
