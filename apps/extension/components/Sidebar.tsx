/**
 * Flows tree (UI_REFERENCE frame_1): section → one row per screen (drag-handle
 * glyph, name, muted current-state name or state count, status dot of its
 * most notable state). A screen row expands to list its states. Clicking a
 * screen or a state flies the board to it.
 */
import { useState } from 'react';
import { frameKey, type Screen } from '@flowcanvas/config';
import { screensBySection } from '@/lib/canvas/layout';
import { STATE_DOT, notableState } from '@/lib/canvas/player';
import { setOverride, usePlay } from '@/lib/canvas/playState';
import { useProject } from '@/store/project';
import { setStep, usePlayerModel } from './Player';

const dotOf = (state: string) => STATE_DOT[state.toLowerCase()];

function Dot({ state }: { state: string | null }) {
  const c = state ? dotOf(state) : undefined;
  return <span aria-hidden className="shrink-0" style={{ inlineSize: 6, blockSize: 6, borderRadius: 3, background: c ?? 'transparent' }} />;
}

export function Sidebar() {
  const config = useProject((s) => s.config);
  const { layout, item, row: activeRow, state: activeState } = usePlayerModel();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = screensBySection(config);

  const go = (sectionId: string, screen: Screen, state: string) => {
    const row = layout.rows.find((r) => r.id === sectionId);
    if (!row) return;
    let i = row.items.findIndex((x) => x.key === frameKey(screen.id, state));
    const exact = i >= 0;
    if (!exact) i = row.items.findIndex((x) => x.screen.id === screen.id);
    if (i < 0) return;
    const it = row.items[i]!;
    if (usePlay.getState().playing) usePlay.setState({ playing: null });
    setOverride(it.key, exact || state === it.state ? null : state);
    setStep(row, i);
  };

  return (
    <nav aria-label="Flows" className="flex h-full w-[190px] shrink-0 flex-col overflow-auto bg-white" style={{ borderInlineEnd: '1px solid var(--fc-line)' }}>
      <h2 className="px-3 pb-1 pt-3" style={{ fontSize: 10, fontWeight: 600, color: 'var(--fc-muted)' }}>
        Flows
      </h2>
      {!groups.length && <p className="px-3" style={{ color: 'var(--fc-muted)' }}>No screens yet.</p>}
      <ul className="pb-6">
        {groups.map((g) => {
          const sectionOpen = !closed[g.id];
          return (
            <li key={g.id} className="mt-1">
              <button
                type="button"
                aria-expanded={sectionOpen}
                className="flex min-h-[24px] w-full items-center gap-1.5 px-2 text-start font-semibold hover:bg-[#f5f5f5]"
                onClick={() => setClosed((c) => ({ ...c, [g.id]: sectionOpen }))}
              >
                <span aria-hidden style={{ inlineSize: 10, color: 'var(--fc-muted)', transform: sectionOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms' }}>
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
              {sectionOpen && (
                <ul>
                  {g.screens.map((s) => {
                    const id = `${g.id}/${s.id}`;
                    const isActive = activeRow?.id === g.id && item?.screen.id === s.id;
                    const shownState = isActive ? activeState : null;
                    const expanded = !!open[id];
                    const notable = notableState(config, s);
                    const muted = shownState && shownState !== s.states[0] ? shownState : s.states.length > 1 ? String(s.states.length) : '';
                    return (
                      <li key={s.id} data-fc-screen-row={s.id}>
                        <div
                          className="mx-1 flex min-h-[24px] items-center rounded-md hover:bg-[#f5f5f5]"
                          style={isActive ? { background: '#efefef' } : undefined}
                        >
                          <button
                            type="button"
                            aria-current={isActive ? 'step' : undefined}
                            className="flex min-h-[24px] min-w-0 flex-1 items-center gap-1.5 ps-2 text-start"
                            onClick={() => go(g.id, s, isActive && shownState ? shownState : s.states[0] ?? 'default')}
                          >
                            <span aria-hidden style={{ color: 'var(--fc-faint)', letterSpacing: -1 }}>
                              ⠿
                            </span>
                            <span className="truncate">{s.title}</span>
                            {muted && (
                              <span className="tnum truncate" style={{ color: 'var(--fc-muted)' }} aria-label={/^\d+$/.test(muted) ? `${muted} states` : `state ${muted}`}>
                                {muted}
                              </span>
                            )}
                            <span className="ms-auto" />
                            <Dot state={notable} />
                            {notable && <span className="sr-only">{notable}</span>}
                          </button>
                          {s.states.length > 1 ? (
                            <button
                              type="button"
                              className="flex h-6 w-5 shrink-0 items-center justify-center"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Hide' : 'Show'} states of ${s.title}`}
                              onClick={() => setOpen((o) => ({ ...o, [id]: !expanded }))}
                            >
                              <span aria-hidden style={{ color: 'var(--fc-faint)', fontSize: 9, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
                                ›
                              </span>
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                        </div>
                        {expanded && (
                          <ul aria-label={`States of ${s.title}`}>
                            {s.states.map((st) => {
                              const cur = isActive && shownState === st;
                              return (
                                <li key={st}>
                                  <button
                                    type="button"
                                    aria-current={cur ? 'step' : undefined}
                                    className="mx-1 flex min-h-[22px] w-[calc(100%-8px)] items-center gap-1.5 rounded-md pe-7 ps-7 text-start hover:bg-[#f5f5f5]"
                                    style={cur ? { background: '#f3f3f3', fontWeight: 600 } : { color: 'var(--fc-muted)' }}
                                    onClick={() => go(g.id, s, st)}
                                  >
                                    <span className="truncate">{st}</span>
                                    <span className="ms-auto" />
                                    <Dot state={st} />
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
