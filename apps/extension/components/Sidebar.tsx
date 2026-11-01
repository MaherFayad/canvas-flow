import { useState } from 'react';
import { frameKey } from '@flowcanvas/config';
import { screensBySection } from '@/lib/canvas/layout';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { setStep, usePlayerModel } from './Player';

/** Status dot by state kind (amber = loading/processing, green = success, red = error…); none for default. Paired with the state name as text. */
const DOT: Record<string, string> = { loading: '#F59E0B', success: '#22A559', error: '#DC2626', empty: '#3B82F6', partial: '#8B5CF6' };

export function Sidebar() {
  const config = useProject((s) => s.config);
  const { layout, item } = usePlayerModel();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = screensBySection(config);

  const go = (sectionId: string, screenId: string, state: string) => {
    const row = layout.rows.find((r) => r.id === sectionId);
    if (!row) return;
    let i = row.items.findIndex((x) => x.key === frameKey(screenId, state));
    if (i < 0) i = row.items.findIndex((x) => x.screen.id === screenId);
    if (i >= 0) setStep(row, i);
  };

  return (
    <nav aria-label="Flows" className="flex h-full w-[190px] shrink-0 flex-col overflow-auto bg-white" style={{ borderInlineEnd: '1px solid var(--fc-line)' }}>
      <h2 className="px-3 pb-1 pt-3" style={{ fontSize: 10, fontWeight: 600, color: 'var(--fc-muted)' }}>
        Flows
      </h2>
      {!groups.length && <p className="px-3" style={{ color: 'var(--fc-muted)' }}>No screens yet.</p>}
      <ul className="pb-6">
        {groups.map((g) => {
          const open = !closed[g.id];
          return (
            <li key={g.id} className="mt-1">
              <button
                type="button"
                aria-expanded={open}
                className="flex min-h-[24px] w-full items-center gap-1.5 px-2 text-start font-semibold hover:bg-[#f5f5f5]"
                onClick={() => setClosed((c) => ({ ...c, [g.id]: open }))}
              >
                <span aria-hidden style={{ inlineSize: 10, color: 'var(--fc-muted)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms' }}>
                  ▾
                </span>
                <svg aria-hidden width="12" height="10" viewBox="0 0 12 10">
                  <path d="M1 1.5h3.5l1 1.2H11v6.3H1z" fill="none" stroke="#8a8a8a" strokeWidth="1" />
                </svg>
                <span className="truncate">{g.title}</span>
                <span className="tnum ms-auto font-normal" style={{ color: 'var(--fc-muted)' }}>
                  {g.screens.length}
                </span>
              </button>
              {open && (
                <ul>
                  {g.screens.flatMap((s) =>
                    s.states.map((st, si) => {
                      const key = frameKey(s.id, st);
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            aria-current={item?.key === key ? 'step' : undefined}
                            className="mx-1 flex min-h-[24px] w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 text-start hover:bg-[#f5f5f5]"
                            style={item?.key === key ? { background: '#efefef' } : undefined}
                            onClick={() => go(g.id, s.id, st)}
                          >
                            <span aria-hidden style={{ color: 'var(--fc-faint)', letterSpacing: -1 }}>
                              ⠿
                            </span>
                            <span className="truncate">{s.title}</span>
                            {si > 0 && (
                              <span className="truncate" style={{ color: 'var(--fc-muted)' }}>
                                {st}
                              </span>
                            )}
                            <span
                              aria-hidden
                              className="ms-auto shrink-0"
                              style={{ inlineSize: 6, blockSize: 6, borderRadius: 3, background: DOT[st.toLowerCase()] ?? 'transparent' }}
                            />
                          </button>
                        </li>
                      );
                    }),
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
