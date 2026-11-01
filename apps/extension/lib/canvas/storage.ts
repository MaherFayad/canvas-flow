/** Working copy in chrome.storage.local, keyed by origin. */
import { parseConfig, type FlowCanvasConfig } from '@flowcanvas/config';

const key = (origin: string) => `project:${origin}`;
const RECENT = 'recent';

export interface StoredProject {
  config: FlowCanvasConfig;
  saved: FlowCanvasConfig;
  deviceId?: string;
}

const area = () => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);

export async function loadProject(origin: string): Promise<StoredProject | null> {
  const a = area();
  if (!a) return null;
  const r = await a.get(key(origin));
  const raw = r[key(origin)] as { config?: unknown; saved?: unknown; deviceId?: string } | undefined;
  if (!raw) return null;
  const c = parseConfig(raw.config);
  if (!c.ok) return null;
  const s = parseConfig(raw.saved);
  return { config: c.config, saved: s.ok ? s.config : c.config, deviceId: raw.deviceId };
}

export async function saveProject(origin: string, p: StoredProject): Promise<void> {
  const a = area();
  if (!a) return;
  await a.set({ [key(origin)]: p });
  const r = await a.get(RECENT);
  const list = ((r[RECENT] as Array<{ origin: string; name: string; at: number }>) ?? []).filter((x) => x.origin !== origin);
  list.unshift({ origin, name: p.config.project.name, at: Date.now() });
  await a.set({ [RECENT]: list.slice(0, 10) });
}

export async function recentProjects(): Promise<Array<{ origin: string; name: string }>> {
  const a = area();
  if (!a) return [];
  const r = await a.get(RECENT);
  return (r[RECENT] as Array<{ origin: string; name: string }>) ?? [];
}
