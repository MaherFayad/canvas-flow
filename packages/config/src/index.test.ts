import { describe, expect, it } from 'vitest';
import { emptyConfig, migrate, parseConfig, serializeConfig } from './index';

const legacy = {
  version: 1,
  project: { name: 'Helka ceramics', origin: 'http://localhost:3000' },
  groups: [{ id: 'onboarding', title: 'Onboarding', order: 0 }],
  screens: [
    { id: 'welcome', title: 'Welcome', group: 'onboarding', path: '/' },
    { id: 'catalog', title: 'Catalog', group: 'onboarding', path: '/catalog', states: ['default', 'empty'] },
  ],
  edges: [{ id: 'e1', from: { screen: 'welcome', state: 'default' }, to: { screen: 'catalog', state: 'default' }, trigger: { label: 'Get started', gesture: 'tap' }, kind: 'happy' }],
  mocks: { 'catalog:empty': [{ match: { method: 'GET', url: '/api/products*' }, status: 200, body: { items: [] } }] },
};

describe('config', () => {
  it('migrates groups → sections and keeps ids', () => {
    const m = migrate(legacy) as any;
    expect(m.groups).toBeUndefined();
    expect(m.sections[0].id).toBe('onboarding');
    expect(m.screens[0].section).toBe('onboarding');
  });
  it('parses the plan example with defaults filled', () => {
    const r = parseConfig(legacy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.edges[0]!.transition.type).toBe('push');
    expect(r.config.devices.length).toBeGreaterThan(0);
    expect(r.config.screens[0]!.states).toEqual(['default']);
  });
  it('flags dangling edge refs and bad ids', () => {
    const r = parseConfig({ ...legacy, edges: [{ id: 'x', from: { screen: 'nope' }, to: { screen: 'catalog' } }] });
    expect(r.ok).toBe(false);
    const r2 = parseConfig({ ...legacy, screens: [{ id: 'Bad Id', title: 'x', path: '/' }] });
    expect(r2.ok).toBe(false);
  });
  it('round-trips through serialize', () => {
    const c = emptyConfig('http://localhost:5173');
    const r = parseConfig(JSON.parse(serializeConfig(c)));
    expect(r.ok && r.config.project.name).toBe('localhost:5173');
  });
});
