import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { CONFIG_FILE, DEVICE_PRESETS, serializeConfig } from '@flowcanvas/config';
import { describeChanges } from '@/lib/canvas/diff';
import { recentProjects } from '@/lib/canvas/storage';
import { isLocalOrigin } from '@/lib/url';
import { redo, undo, useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { Segmented } from './Segmented';

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

function ProjectMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as HTMLElement) && setOpen(false);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  const item = 'block w-full text-start px-3 min-h-[26px] hover:bg-[#f2f2f2]';
  return (
    <div ref={ref} className="relative">
      <button className="fc-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="max-w-[180px] truncate">{name}</span>
        <span aria-hidden style={{ fontSize: 8 }}>
          ▼
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute z-50 mt-1 min-w-[200px] rounded-lg border border-[#e6e6e6] bg-white py-1 shadow-lg">
          <button role="menuitem" className={item} onClick={() => (setOpen(false), useUi.getState().set({ importOpen: true }))}>
            Import config…
          </button>
          <button role="menuitem" className={item} onClick={() => (setOpen(false), downloadConfig())}>
            Download {CONFIG_FILE}
          </button>
          <button role="menuitem" className={item} onClick={() => (setOpen(false), useUi.getState().set({ discoverRun: useUi.getState().discoverRun + 1 }))}>
            Discover screens again
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const config = useProject((s) => s.config);
  const saved = useProject((s) => s.saved);
  const canUndo = useStore(useProject.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProject.temporal, (s) => s.futureStates.length > 0);
  const mode = useUi((s) => s.mode);
  const deviceId = useUi((s) => s.deviceId);
  const origin = useUi((s) => s.origin);
  const tokensOpen = useUi((s) => s.tokensOpen);
  const draftCount = useUi((s) => Object.keys(s.tokenDraft).length);
  const set = useUi((s) => s.set);
  const changes = useMemo(() => describeChanges(saved, config), [saved, config]);
  const device = deviceById(config.devices, deviceId);
  const devices = useMemo(() => {
    const all = [...config.devices];
    for (const d of DEVICE_PRESETS) if (!all.some((x) => x.id === d.id)) all.push(d);
    return all;
  }, [config.devices]);
  const isDesktop = device.chrome === 'none';
  const [originDraft, setOriginDraft] = useState(origin);
  const [recent, setRecent] = useState<Array<{ origin: string; name: string }>>([]);
  useEffect(() => setOriginDraft(origin), [origin]);
  useEffect(() => void recentProjects().then(setRecent), []);
  const originOk = isLocalOrigin(originDraft);

  return (
    <header className="flex items-center gap-2 bg-white px-3" style={{ blockSize: 36, borderBlockEnd: '1px solid var(--fc-line)' }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }} className="me-1 whitespace-nowrap">
        Flow Canvas
      </span>
      <ProjectMenu name={config.project.name} />
      <Segmented label="View" options={['player', 'canvas'] as const} value={mode} render={(v) => (v === 'player' ? 'Player' : 'Canvas')} onChange={(v) => set({ mode: v })} />
      <Segmented
        label="Viewport"
        options={['mobile', 'desktop'] as const}
        value={isDesktop ? 'desktop' : 'mobile'}
        render={(v) => (v === 'mobile' ? 'Mobile' : 'Desktop')}
        onChange={(v) => set({ deviceId: v === 'desktop' ? (devices.find((d) => d.chrome === 'none')?.id ?? 'desktop') : (devices.find((d) => d.chrome !== 'none')?.id ?? DEVICE_PRESETS[0]!.id) })}
      />
      <label className="sr-only" htmlFor="fc-device">
        Device
      </label>
      <select id="fc-device" className="fc-select" style={{ border: 0 }} value={device.id} onChange={(e) => set({ deviceId: e.target.value })}>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label} · {d.w}×{d.h}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!originOk) return;
          const u = new URL(location.href);
          u.searchParams.set('origin', new URL(originDraft).origin);
          location.href = u.toString();
        }}
      >
        <label className="sr-only" htmlFor="fc-origin">
          App origin
        </label>
        <input
          id="fc-origin"
          className="fc-input mono"
          style={{ border: 0, color: 'var(--fc-muted)', inlineSize: 170, textAlign: 'end' }}
          list="fc-recent"
          value={originDraft}
          placeholder="http://localhost:5173"
          aria-invalid={!!originDraft && !originOk}
          onChange={(e) => setOriginDraft(e.target.value)}
          onBlur={() => originDraft !== origin && !originOk && setOriginDraft(origin)}
        />
        <datalist id="fc-recent">
          {recent.map((r) => (
            <option key={r.origin} value={r.origin}>
              {r.name}
            </option>
          ))}
        </datalist>
      </form>

      {mode === 'canvas' && (
        <>
          <button className="fc-btn" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
            ↶
          </button>
          <button className="fc-btn" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>
            ↷
          </button>
        </>
      )}
      <span role="status" className="tnum whitespace-nowrap" style={{ color: 'var(--fc-orange)', minInlineSize: changes.count ? undefined : 0 }}>
        {changes.text}
      </span>
      {changes.count > 0 && (
        <>
          <button
            className="fc-btn"
            onClick={() => window.confirm(`Discard ${changes.text}?`) && useProject.getState().discard()}
          >
            Discard
          </button>
          <button className="fc-btn primary" onClick={downloadConfig} title={`Download ${CONFIG_FILE}`}>
            {changes.onlyEdges ? 'Save edges' : 'Save'}
          </button>
        </>
      )}
      <button
        className="fc-btn"
        aria-pressed={tokensOpen}
        style={tokensOpen ? { background: '#f0f0f0' } : undefined}
        onClick={() => set({ tokensOpen: !tokensOpen, selectedEdge: null })}
      >
        Tokens
        {draftCount > 0 && (
          <span className="tnum" aria-label={`${draftCount} unsaved token changes`} style={{ background: 'var(--fc-orange)', color: '#fff', borderRadius: 999, minInlineSize: 14, blockSize: 14, fontSize: 9, display: 'inline-grid', placeItems: 'center', paddingInline: 3 }}>
            {draftCount}
          </span>
        )}
      </button>
    </header>
  );
}
