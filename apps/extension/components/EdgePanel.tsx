import { useEffect, useState, type ReactNode } from 'react';
import { EASING_PRESETS, EDGE_KINDS, GESTURES, TRANSITIONS, type Edge } from '@flowcanvas/config';
import type { MessageOf } from '@flowcanvas/protocol';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useHost } from './host';

type Check = 'idle' | 'checking' | 'found' | 'missing' | 'offline';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

export function EdgePanel({ edge }: { edge: Edge }) {
  const host = useHost();
  const update = (fn: (e: Edge) => Edge) => useProject.getState().updateEdge(edge.id, fn);
  const [check, setCheck] = useState<Check>('idle');
  const fromScreen = useProject((s) => s.config.screens.find((x) => x.id === edge.from.screen));
  const toScreen = useProject((s) => s.config.screens.find((x) => x.id === edge.to.screen));
  // Local drafts so typing is not one undo step per key.
  const [label, setLabel] = useState(edge.trigger.label);
  const [hint, setHint] = useState(edge.trigger.hint ?? '');
  const [target, setTarget] = useState(edge.trigger.target ?? '');
  useEffect(() => {
    setLabel(edge.trigger.label);
    setHint(edge.trigger.hint ?? '');
    setTarget(edge.trigger.target ?? '');
  }, [edge.id, edge.trigger.label, edge.trigger.hint, edge.trigger.target]);

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

  const easingKey = Object.entries(EASING_PRESETS).find(([, v]) => v === edge.transition.easing)?.[0] ?? 'custom';
  const commitText = () => {
    if (label === edge.trigger.label && hint === (edge.trigger.hint ?? '') && target === (edge.trigger.target ?? '')) return;
    update((e) => ({ ...e, trigger: { ...e.trigger, label, hint: hint || undefined, target: target || undefined } }));
  };

  return (
    <aside
      aria-label="Edge settings"
      className="absolute z-20 flex w-[300px] flex-col gap-3 overflow-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
      style={{ insetInlineEnd: 16, insetBlockStart: 16, maxBlockSize: 'calc(100% - 32px)' }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Edge</h2>
        <span className="truncate text-[12px] text-gray-500">
          {fromScreen?.title ?? edge.from.screen} / {edge.from.state} → {toScreen?.title ?? edge.to.screen}
        </span>
        <button className="fc-btn" style={{ marginInlineStart: 'auto' }} aria-label="Close edge panel" onClick={() => useUi.getState().set({ selectedEdge: null })}>
          ✕
        </button>
      </div>
      <Field label="Label">
        <input className="fc-input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commitText} />
      </Field>
      <Field label="Hint (shown on the Player arrow)">
        <input className="fc-input" value={hint} onChange={(e) => setHint(e.target.value)} onBlur={commitText} />
      </Field>
      <Field label="Gesture">
        <select className="fc-select" value={edge.trigger.gesture} onChange={(e) => update((x) => ({ ...x, trigger: { ...x.trigger, gesture: e.target.value as Edge['trigger']['gesture'] } }))}>
          {GESTURES.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </Field>
      <Field label="Target selector">
        <input
          className="fc-input font-mono"
          value={target}
          placeholder='[data-fc="get-started"]'
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => {
            commitText();
            void runCheck(target);
          }}
        />
      </Field>
      <div role="status" className="text-[13px]">
        {check === 'found' && <span className="font-medium text-green-700">✓ Found in the app on this state</span>}
        {check === 'missing' && <span className="font-medium text-red-700">✕ Not found on this state</span>}
        {check === 'checking' && <span className="text-gray-500">Checking…</span>}
        {check === 'offline' && <span className="text-gray-500">Frame not live: zoom in on {edge.from.state} to check</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Transition">
          <select className="fc-select" value={edge.transition.type} onChange={(e) => update((x) => ({ ...x, transition: { ...x.transition, type: e.target.value as Edge['transition']['type'] } }))}>
            {TRANSITIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Duration (ms)">
          <input
            className="fc-input"
            type="number"
            min={0}
            step={20}
            defaultValue={edge.transition.duration}
            key={`${edge.id}-${edge.transition.duration}`}
            onBlur={(e) => {
              const v = Math.max(0, Number(e.target.value) || 0);
              if (v !== edge.transition.duration) update((x) => ({ ...x, transition: { ...x.transition, duration: v } }));
            }}
          />
        </Field>
      </div>
      <Field label="Easing">
        <select
          className="fc-select"
          value={easingKey}
          onChange={(e) => {
            const v = EASING_PRESETS[e.target.value];
            if (v) update((x) => ({ ...x, transition: { ...x.transition, easing: v } }));
          }}
        >
          {Object.keys(EASING_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          {easingKey === 'custom' && <option value="custom">custom: {edge.transition.easing}</option>}
        </select>
      </Field>
      <fieldset className="flex flex-col gap-1 text-[13px]">
        <legend className="mb-1 font-medium text-gray-700">Kind</legend>
        <div className="fc-seg">
          {EDGE_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={edge.kind === k} onClick={() => update((x) => ({ ...x, kind: k }))}>
              {k}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2 pt-1">
        <button className="fc-btn" disabled title="Player arrives in M4">
          Play edge
        </button>
        <button
          className="fc-btn"
          style={{ color: 'var(--fc-danger)', marginInlineStart: 'auto' }}
          onClick={() => {
            useProject.getState().deleteEdge(edge.id);
            useUi.getState().set({ selectedEdge: null, announce: 'Edge deleted' });
          }}
        >
          Delete
        </button>
      </div>
    </aside>
  );
}
