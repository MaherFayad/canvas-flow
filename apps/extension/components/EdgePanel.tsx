import { useEffect, useState, type ReactNode } from 'react';
import { EASING_PRESETS, EDGE_KINDS, GESTURES, TRANSITIONS, type Edge } from '@flowcanvas/config';
import type { MessageOf } from '@flowcanvas/protocol';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useHost } from './host';
import { Segmented } from './Segmented';
import { BezierEditor } from './BezierEditor';

type Check = 'idle' | 'checking' | 'found' | 'missing' | 'offline';

/** Easing chips, two rows as in the reference. */
const EASE_ROW_1: Array<[string, string]> = [
  ['ease-out', 'ease-out'],
  ['ease-in', 'ease-in'],
  ['ease-in-out', 'ease-in-out'],
  ['linear', 'linear'],
];
const EASE_ROW_2: Array<[string, string]> = [
  ['Snappy', EASING_PRESETS.snappy!],
  ['Emphasized', EASING_PRESETS.emphasized!],
  ['Sheet', EASING_PRESETS.sheet!],
  ['Overshoot', EASING_PRESETS.overshoot!],
];

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: '52px 1fr' }}>
      <label htmlFor={htmlFor} style={{ color: 'var(--fc-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function EdgePanel({ edge }: { edge: Edge }) {
  const host = useHost();
  const update = (fn: (e: Edge) => Edge) => useProject.getState().updateEdge(edge.id, fn);
  const [check, setCheck] = useState<Check>('idle');
  const fromScreen = useProject((s) => s.config.screens.find((x) => x.id === edge.from.screen));
  const toScreen = useProject((s) => s.config.screens.find((x) => x.id === edge.to.screen));
  const savedJson = useProject((s) => {
    const e = s.saved.edges.find((x) => x.id === edge.id);
    return e ? JSON.stringify(e) : null;
  });
  const edited = savedJson !== JSON.stringify(edge);
  // Local drafts so typing is one undo step on blur, not one per key.
  const [label, setLabel] = useState(edge.trigger.label);
  const [hint, setHint] = useState(edge.trigger.hint ?? '');
  const [target, setTarget] = useState(edge.trigger.target ?? '');
  const [dur, setDur] = useState(edge.transition.duration);
  useEffect(() => {
    setLabel(edge.trigger.label);
    setHint(edge.trigger.hint ?? '');
    setTarget(edge.trigger.target ?? '');
    setDur(edge.transition.duration);
  }, [edge.id, edge.trigger.label, edge.trigger.hint, edge.trigger.target, edge.transition.duration]);

  const runCheck = async (sel: string) => {
    if (!host || !sel) return setCheck('idle');
    const f = host.framesFor(edge.from.screen, edge.from.state).find((x) => x.nonce);
    if (!f) return setCheck('offline');
    setCheck('checking');
    const r = await host.request<MessageOf<'query-result'>>(f.frameId, { fc: 'query', id: '', selector: sel });
    setCheck(r ? (r.found ? 'found' : 'missing') : 'offline');
  };
  useEffect(() => {
    void runCheck(edge.trigger.target ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge.id, edge.trigger.target]);

  const commitText = () => {
    if (label === edge.trigger.label && hint === (edge.trigger.hint ?? '') && target === (edge.trigger.target ?? '')) return;
    update((e) => ({ ...e, trigger: { ...e.trigger, label, hint: hint || undefined, target: target || undefined } }));
  };
  const commitDur = (v: number) => v !== edge.transition.duration && update((x) => ({ ...x, transition: { ...x.transition, duration: v } }));
  const setEasing = (v: string) => v !== edge.transition.easing && update((x) => ({ ...x, transition: { ...x.transition, easing: v } }));
  const chip = (name: string, value: string) => (
    <button
      key={name}
      type="button"
      className="fc-btn"
      aria-pressed={edge.transition.easing === value}
      style={{ fontSize: 10, paddingInline: 4, whiteSpace: 'nowrap', ...(edge.transition.easing === value ? { background: 'var(--fc-black)', color: '#fff', borderRadius: 999 } : { color: 'var(--fc-muted)' }) }}
      onClick={() => setEasing(value)}
    >
      {name}
    </button>
  );

  return (
    <aside aria-label="Edge inspector" className="fc-panel" onKeyDown={(e) => e.stopPropagation()}>
      <section className="flex flex-col gap-1 px-3 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="mono font-semibold">{edge.id}</span>
          {edited && (
            <span style={{ fontSize: 10, color: 'var(--fc-orange)', background: '#fff3e6', borderRadius: 4, paddingInline: 5 }}>edited</span>
          )}
          <button className="fc-btn ms-auto" aria-label="Close edge inspector" onClick={() => useUi.getState().set({ selectedEdge: null })}>
            ✕
          </button>
        </div>
        <div className="truncate" style={{ color: 'var(--fc-muted)' }}>
          {fromScreen?.title ?? edge.from.screen} · {edge.from.state} → {toScreen?.title ?? edge.to.screen} · {edge.to.state}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-3 py-3">
        <h3 className="fc-label">Trigger</h3>
        <Row label="Label" htmlFor="ep-label">
          <input id="ep-label" className="fc-input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commitText} />
        </Row>
        <Row label="Hint" htmlFor="ep-hint">
          <input id="ep-hint" className="fc-input" placeholder="Shown on the player's arrow" value={hint} onChange={(e) => setHint(e.target.value)} onBlur={commitText} />
        </Row>
        <Row label="Gesture" htmlFor="ep-gesture">
          <select
            id="ep-gesture"
            className="fc-select"
            value={edge.trigger.gesture}
            onChange={(e) => update((x) => ({ ...x, trigger: { ...x.trigger, gesture: e.target.value as Edge['trigger']['gesture'] } }))}
          >
            {GESTURES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Row>
        <Row label="Target" htmlFor="ep-target">
          <input
            id="ep-target"
            className="fc-input mono"
            value={target}
            placeholder='[data-fc="get-started"]'
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => (commitText(), void runCheck(target))}
          />
        </Row>
        <div role="status" style={{ fontSize: 10, minBlockSize: 14 }}>
          {check === 'found' && <span style={{ color: 'var(--fc-green)' }}>✓ Found in the app on this state</span>}
          {check === 'missing' && <span style={{ color: 'var(--fc-red)' }}>✕ Not found on this state</span>}
          {check === 'checking' && <span style={{ color: 'var(--fc-muted)' }}>Checking…</span>}
          {check === 'offline' && <span style={{ color: 'var(--fc-muted)' }}>Frame not live: zoom in on “{edge.from.state}” to check</span>}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-3 py-3">
        <h3 className="fc-label">Transition</h3>
        <Segmented
          label="Transition type"
          variant="dark"
          grid3
          options={TRANSITIONS}
          value={edge.transition.type}
          onChange={(v) => update((x) => ({ ...x, transition: { ...x.transition, type: v } }))}
        />
        <Row label="Duration" htmlFor="ep-dur">
          <div className="flex items-center gap-1.5">
            <input
              id="ep-dur"
              type="range"
              className="fc-range"
              min={0}
              max={1000}
              step={10}
              value={dur}
              onChange={(e) => setDur(Number(e.target.value))}
              onPointerUp={() => commitDur(dur)}
              onKeyUp={() => commitDur(dur)}
            />
            <input
              className="fc-input tnum"
              aria-label="Duration in ms"
              style={{ inlineSize: 44, textAlign: 'end' }}
              inputMode="numeric"
              value={dur}
              onChange={(e) => setDur(Math.max(0, Number(e.target.value) || 0))}
              onBlur={() => commitDur(dur)}
            />
            <span style={{ color: 'var(--fc-muted)' }}>ms</span>
          </div>
        </Row>
        <div role="group" aria-label="Easing presets" className="grid grid-cols-4 gap-0.5">
          {EASE_ROW_1.map(([n, v]) => chip(n, v))}
          {EASE_ROW_2.map(([n, v]) => chip(n, v))}
        </div>
        <BezierEditor easing={edge.transition.easing} duration={dur} onChange={setEasing} />
      </section>

      <section className="flex flex-col gap-2 px-3 py-3">
        <h3 className="fc-label">Kind</h3>
        <Segmented label="Edge kind" variant="dark" options={EDGE_KINDS} value={edge.kind} onChange={(k) => update((x) => ({ ...x, kind: k }))} />
      </section>

      <section className="flex items-center gap-2 px-3 py-3">
        <button className="fc-btn primary flex-1" title="Player transitions arrive in M4" disabled style={{ opacity: 0.85 }}>
          ▶ Play edge
        </button>
        <button
          className="fc-btn danger"
          onClick={() => {
            useProject.getState().deleteEdge(edge.id);
            useUi.getState().set({ selectedEdge: null, announce: 'Edge deleted' });
          }}
        >
          Delete
        </button>
      </section>
    </aside>
  );
}
