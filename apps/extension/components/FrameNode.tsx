import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Device, Screen } from '@flowcanvas/config';
import { frameUrl } from '@flowcanvas/protocol';
import { badgeColors } from '@/lib/canvas/badges';
import { HOVER_LIVE_MS } from '@/lib/canvas/live';
import { chromeInsets } from '@/lib/canvas/geometry';
import { WINDOW_NAME_PREFIX } from '@/lib/frame';
import { useHost } from './host';
import { useUi } from '@/store/ui';
import { useProject } from '@/store/project';

export type FrameNodeData = {
  screen: Screen;
  state: string;
  device: Device;
  live: boolean;
  origin: string;
  index: number;
  total: number;
};
export type FrameNodeType = Node<FrameNodeData, 'frame'>;

function StatusBar() {
  return (
    <>
      <span>9:41</span>
      <span className="fc-island" aria-hidden />
      <span aria-hidden style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="18" height="12" viewBox="0 0 18 12">
          <rect x="0" y="8" width="3" height="4" rx="1" fill="#111" />
          <rect x="5" y="5" width="3" height="7" rx="1" fill="#111" />
          <rect x="10" y="2" width="3" height="10" rx="1" fill="#111" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="#111" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="#111" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill="#111" />
          <rect x="24" y="4" width="2" height="4" rx="1" fill="#111" />
        </svg>
      </span>
    </>
  );
}

function FrameMenu({ screen, state, src, onReload }: { screen: Screen; state: string; src: string; onReload: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  const item = 'block w-full text-start px-3 py-1.5 text-[13px] hover:bg-gray-100 min-h-[28px]';
  return (
    <div ref={ref} className="relative nodrag" style={{ marginInlineStart: 'auto' }}>
      <button
        type="button"
        className="fc-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Frame menu: ${screen.title}, ${state}`}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute z-50 mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg" style={{ insetInlineEnd: 0 }}>
          <button role="menuitem" className={item} onClick={() => (onReload(), setOpen(false))}>
            Reload
          </button>
          <button role="menuitem" className={item} onClick={() => (window.open(src.replace(/[?&]fc-frame=[^&]*/, ''), '_blank'), setOpen(false))}>
            Open in tab
          </button>
          <button role="menuitem" className={item} onClick={() => (void navigator.clipboard?.writeText(src), setOpen(false))}>
            Copy link
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              const name = window.prompt(`New state name for ${screen.title} (copy of "${state}")`, '');
              if (name && !useProject.getState().duplicateState(screen.id, state, name)) {
                window.alert(`"${name}" is empty or already a state of ${screen.title}.`);
              }
            }}
          >
            Duplicate as new state…
          </button>
          <button
            role="menuitem"
            className={item + ' text-red-700'}
            onClick={() => {
              setOpen(false);
              useProject.getState().deleteFrame(screen.id, state);
            }}
          >
            {screen.states.length > 1 ? 'Delete this state' : 'Delete screen'}
          </button>
        </div>
      )}
    </div>
  );
}

function LiveIframe({ data, interactive, reloadKey }: { data: FrameNodeData; interactive: boolean; reloadKey: number }) {
  const host = useHost();
  // New frame id per mount: stale messages from an older iframe are never accepted.
  const frameId = useMemo(
    () => `${data.screen.id}~${data.state}~${Math.random().toString(36).slice(2, 8)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.screen.id, data.state, reloadKey],
  );
  const src = frameUrl(data.origin, data.screen.path, frameId, data.state);
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!host) return;
    host.register(frameId, { screen: data.screen.id, state: data.state, path: data.screen.path }, ref.current);
    useUi.getState().setStatus(`${data.screen.id}:${data.state}`, 'loading');
    return () => host.unregister(frameId);
  }, [host, frameId, data.screen.id, data.state, data.screen.path]);
  return (
    <iframe
      ref={ref}
      key={frameId}
      name={WINDOW_NAME_PREFIX + frameId}
      title={`${data.screen.title}, ${data.state} state`}
      src={src}
      width={data.device.w}
      height={data.device.h}
      style={{ border: 0, display: 'block', pointerEvents: interactive ? 'auto' : 'none', background: '#fff' }}
    />
  );
}

function FrameNodeImpl({ data, selected, id }: NodeProps<FrameNodeType>) {
  const { screen, state, device } = data;
  const ins = chromeInsets(device);
  const badge = badgeColors(state);
  const recording = useUi((s) => s.recording);
  const status = useUi((s) => s.status[id]);
  const [reloadKey, setReloadKey] = useState(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const interactive = selected || recording;
  const src = frameUrl(data.origin, screen.path, 'open', state);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const screenStyle: CSSProperties = { inlineSize: device.w, blockSize: device.h };
  return (
    <div
      className="fc-frame"
      onPointerEnter={() => {
        if (data.live) return;
        hoverTimer.current = setTimeout(() => useUi.getState().force(id, true), HOVER_LIVE_MS);
      }}
      onPointerLeave={() => {
        clearTimeout(hoverTimer.current);
        if (useUi.getState().forced.has(id)) useUi.getState().force(id, false);
      }}
    >
      <div className="fc-frame-header fc-drag">
        <span className="fc-frame-title">{screen.title}</span>
        <span className="text-[13px] text-gray-500">{state}</span>
        <span className="fc-badge" style={{ background: badge.bg, color: badge.fg }}>
          {state}
        </span>
        <span className="sr-only">{status === 'ready' ? 'ready' : status === 'connected' ? 'connected' : data.live ? 'loading' : 'still'}</span>
        <FrameMenu screen={screen} state={state} src={src} onReload={() => setReloadKey((k) => k + 1)} />
      </div>
      <div className={`fc-device ${device.chrome}`} style={{ padding: ins.side }}>
        <div className="fc-screen">
          {device.chrome === 'ios' && (
            <div className="fc-statusbar" style={{ blockSize: ins.top - ins.side }}>
              <StatusBar />
            </div>
          )}
          {device.chrome === 'android' && <div className="fc-statusbar" style={{ blockSize: ins.top - ins.side, fontSize: 14 }}>9:41</div>}
          <div style={{ ...screenStyle, position: 'relative' }}>
            {data.live ? (
              <LiveIframe data={data} interactive={interactive} reloadKey={reloadKey} />
            ) : (
              <div className="fc-still">
                <span style={{ fontWeight: 600, color: '#374151' }}>{screen.title}</span>
                <span style={{ fontSize: 16 }}>{screen.path}</span>
                <span style={{ fontSize: 14 }}>Still. Zoom in or hover to load.</span>
              </div>
            )}
          </div>
          {device.chrome === 'ios' && (
            <div className="fc-homebar" style={{ blockSize: ins.bottom }}>
              <span />
            </div>
          )}
          {device.chrome === 'android' && <div className="fc-homebar" style={{ blockSize: ins.bottom }} />}
        </div>
      </div>
      <Handle type="target" position={Position.Left} style={{ top: '50%' }} aria-label={`Edge target: ${screen.title} ${state}`} />
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} aria-label={`Start edge from ${screen.title} ${state}`} />
    </div>
  );
}

export const FrameNode = memo(FrameNodeImpl);
