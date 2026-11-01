import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useReactFlow } from '@xyflow/react';
import { CONFIG_FILE, DEVICE_PRESETS, serializeConfig } from '@flowcanvas/config';
import { countChanges } from '@/lib/canvas/diff';
import { recentProjects } from '@/lib/canvas/storage';
import { isLocalOrigin } from '@/lib/url';
import { redo, undo, useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';

export function downloadConfig() {
  const { config } = useProject.getState();
  const blob = new Blob([serializeConfig(config)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = CONFIG_FILE;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  useProject.getState().markSaved();
  useUi.getState().set({ announce: `Saved ${CONFIG_FILE}` });
}

export function TopBar() {
  const config = useProject((s) => s.config);
  const saved = useProject((s) => s.saved);
  const canUndo = useStore(useProject.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProject.temporal, (s) => s.futureStates.length > 0);
  const mode = useUi((s) => s.mode);
  const deviceId = useUi((s) => s.deviceId);
  const recording = useUi((s) => s.recording);
  const origin = useUi((s) => s.origin);
  const set = useUi((s) => s.set);
  const rf = useReactFlow();
  const unsaved = useMemo(() => countChanges(saved, config), [saved, config]);
  const device = deviceById(config.devices, deviceId);
  const devices = useMemo(() => {
    const all = [...config.devices];
    for (const d of DEVICE_PRESETS) if (!all.some((x) => x.id === d.id)) all.push(d);
    return all;
  }, [config.devices]);
  const isDesktop = device.chrome === 'none' && device.w >= 1024;
  const [originDraft, setOriginDraft] = useState(origin);
  const [recent, setRecent] = useState<Array<{ origin: string; name: string }>>([]);
  useEffect(() => setOriginDraft(origin), [origin]);
  useEffect(() => void recentProjects().then(setRecent), []);
  const originOk = isLocalOrigin(originDraft);

  const goOrigin = () => {
    if (!originOk) return;
    const o = new URL(originDraft).origin;
    const u = new URL(location.href);
    u.searchParams.set('origin', o);
    location.href = u.toString();
  };

  return (
    <header className="flex min-h-[52px] flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
      <h1 className="me-2 max-w-[220px] truncate text-[15px] font-semibold" title={config.project.name}>
        {config.project.name}
      </h1>
      <div className="fc-seg" role="group" aria-label="View">
        <button aria-pressed={mode === 'canvas'} onClick={() => set({ mode: 'canvas' })}>
          Canvas
        </button>
        <button aria-pressed={mode === 'player'} onClick={() => set({ mode: 'player' })}>
          Player
        </button>
      </div>
      <div className="fc-seg" role="group" aria-label="Viewport">
        <button aria-pressed={!isDesktop} onClick={() => set({ deviceId: devices.find((d) => d.chrome !== 'none')?.id ?? DEVICE_PRESETS[0]!.id })}>
          Mobile
        </button>
        <button aria-pressed={isDesktop} onClick={() => set({ deviceId: devices.find((d) => d.chrome === 'none' && d.w >= 1024)?.id ?? 'desktop' })}>
          Desktop
        </button>
      </div>
      <label className="sr-only" htmlFor="fc-device">
        Device
      </label>
      <select id="fc-device" className="fc-select" value={device.id} onChange={(e) => set({ deviceId: e.target.value })}>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label} ({d.w}×{d.h})
          </option>
        ))}
      </select>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          goOrigin();
        }}
      >
        <label className="sr-only" htmlFor="fc-origin">
          App origin
        </label>
        <input
          id="fc-origin"
          className="fc-input w-[210px] font-mono"
          list="fc-recent"
          value={originDraft}
          placeholder="http://localhost:3000"
          aria-invalid={!!originDraft && !originOk}
          onChange={(e) => setOriginDraft(e.target.value)}
        />
        <datalist id="fc-recent">
          {recent.map((r) => (
            <option key={r.origin} value={r.origin}>
              {r.name}
            </option>
          ))}
        </datalist>
        {originDraft !== origin && (
          <button className="fc-btn" type="submit" disabled={!originOk}>
            Open
          </button>
        )}
      </form>

      <div className="fc-seg" role="group" aria-label="Zoom">
        {[0.25, 0.5, 1].map((z) => (
          <button key={z} onClick={() => void rf.zoomTo(z, { duration: 200 })}>
            {z * 100}%
          </button>
        ))}
        <button onClick={() => void rf.fitView({ padding: 0.15, duration: 250 })}>Fit</button>
      </div>

      <div className="ms-auto flex items-center gap-2">
        <button className="fc-btn" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
          ↶
        </button>
        <button className="fc-btn" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>
          ↷
        </button>
        <button
          className="fc-btn rec"
          aria-pressed={recording}
          title="Record mode (R)"
          onClick={() => set({ recording: !recording, announce: recording ? 'Recording off' : 'Recording on' })}
        >
          <span aria-hidden>●</span> {recording ? 'Recording' : 'Record'}
        </button>
        <span className="min-w-[88px] text-center text-[13px] text-gray-600" role="status" aria-live="polite">
          {unsaved ? `${unsaved} unsaved` : 'All saved'}
        </span>
        <button
          className="fc-btn"
          disabled={!unsaved}
          onClick={() => {
            if (window.confirm(`Discard ${unsaved} unsaved change${unsaved > 1 ? 's' : ''}?`)) useProject.getState().discard();
          }}
        >
          Discard
        </button>
        <button className="fc-btn" onClick={() => set({ importOpen: true })}>
          Import
        </button>
        <button className="fc-btn primary" onClick={downloadConfig} title={`Download ${CONFIG_FILE}`}>
          Save
        </button>
      </div>
    </header>
  );
}
