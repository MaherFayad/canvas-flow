import { useReactFlow } from '@xyflow/react';
import { frameKey } from '@flowcanvas/config';
import { badgeColors } from '@/lib/canvas/badges';
import { layoutFrames, screensBySection } from '@/lib/canvas/layout';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Sidebar() {
  const config = useProject((s) => s.config);
  const deviceId = useUi((s) => s.deviceId);
  const status = useUi((s) => s.status);
  const live = useUi((s) => s.live);
  const rf = useReactFlow();
  const groups = screensBySection(config);

  const flyTo = (key: string, label: string) => {
    const { frames } = layoutFrames(config, deviceById(config.devices, deviceId));
    const f = frames.find((x) => x.key === key);
    if (!f) return;
    const zoom = Math.max(rf.getZoom(), 0.6);
    void rf.setCenter(f.x + f.w / 2, f.y + f.h / 2, { zoom, duration: reducedMotion() ? 0 : 450 });
    useUi.getState().set({ selectedFrame: key, announce: label });
  };

  return (
    <nav aria-label="Flows" className="flex h-full w-[260px] shrink-0 flex-col overflow-auto border-e border-gray-200 bg-white">
      <h2 className="px-4 pb-2 pt-4 text-[12px] font-semibold uppercase tracking-wider text-gray-500">Flows</h2>
      {!groups.length && <p className="px-4 text-[13px] text-gray-500">No screens yet.</p>}
      <ul className="pb-6">
        {groups.map((g) => (
          <li key={g.id} className="mt-2">
            <div className="flex items-center gap-2 px-4 py-1 text-[13px] font-semibold">
              <span className="truncate">{g.title}</span>
              <span className="ms-auto rounded-full bg-gray-100 px-2 text-[12px] font-medium text-gray-600" aria-label={`${g.screens.length} screens`}>
                {g.screens.length}
              </span>
            </div>
            <ul>
              {g.screens.map((s) => (
                <li key={s.id}>
                  <div className="truncate px-4 ps-6 pt-1 text-[13px] text-gray-800">{s.title}</div>
                  <ul>
                    {s.states.map((st) => {
                      const key = frameKey(s.id, st);
                      const stt = status[key];
                      const dot = live.has(key) ? (stt === 'ready' ? '#16a34a' : '#f59e0b') : '#cbd5e1';
                      const word = live.has(key) ? (stt === 'ready' ? 'ready' : 'loading') : 'still';
                      const b = badgeColors(st);
                      return (
                        <li key={st}>
                          <button
                            type="button"
                            className="flex min-h-[28px] w-full items-center gap-2 px-4 ps-9 text-start text-[13px] hover:bg-gray-50"
                            onClick={() => flyTo(key, `${s.title}, ${st} state`)}
                          >
                            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
                            <span className="sr-only">{word}:</span>
                            <span className="rounded px-1.5 text-[11px] font-semibold uppercase" style={{ background: b.bg, color: b.fg }}>
                              {st}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
