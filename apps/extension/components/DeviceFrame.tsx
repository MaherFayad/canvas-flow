/**
 * Device frame shared by Player and Canvas: light iOS/Android shell or a plain
 * desktop window around an iframe at the device's real CSS size.
 * Live/still swap is invisible (motion rule 3): the still stays on top until
 * the frame sends `ready`, then fades out; going still fades the still in
 * before the iframe unloads.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { Device, Screen } from '@flowcanvas/config';
import { frameUrl } from '@flowcanvas/protocol';
import { chromeInsets } from '@/lib/canvas/geometry';
import { WINDOW_NAME_PREFIX } from '@/lib/frame';
import { useStill } from '@/lib/canvas/capture';
import { useUi } from '@/store/ui';
import { useHost } from './host';

const FADE_MS = 150;
/** No bridge answer (e.g. page without our content scripts): reveal after load + this. */
const READY_FALLBACK_MS = 2500;

export function StatusBar() {
  return (
    <>
      <span>9:41</span>
      <span className="fc-island" aria-hidden />
      <span aria-hidden style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11">
          <rect x="0" y="7" width="3" height="4" rx="1" fill="#111" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" fill="#111" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="#111" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" fill="#111" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11">
          <path d="M7.5 2.2c2.1 0 4 .8 5.5 2.2l1.1-1.1A9.3 9.3 0 0 0 7.5.6 9.3 9.3 0 0 0 .9 3.3L2 4.4a7.7 7.7 0 0 1 5.5-2.2Zm0 3.2c1.2 0 2.3.5 3.2 1.3l1.1-1.1a6.2 6.2 0 0 0-8.6 0l1.1 1.1c.9-.8 2-1.3 3.2-1.3Zm0 3.2c-.4 0-.8.2-1 .4L7.5 10l1-1c-.2-.2-.6-.4-1-.4Z" fill="#111" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" fill="none" stroke="#111" opacity=".4" />
          <rect x="2" y="2" width="18" height="8" rx="2" fill="#111" />
          <rect x="23" y="4" width="1.5" height="4" rx=".75" fill="#111" opacity=".4" />
        </svg>
      </span>
    </>
  );
}

function LiveIframe({
  screen,
  state,
  device,
  origin,
  interactive,
  reloadKey,
  onReady,
}: {
  screen: Screen;
  state: string;
  device: Device;
  origin: string;
  interactive: boolean;
  reloadKey: number;
  onReady: () => void;
}) {
  const host = useHost();
  // New frame id per mount: stale messages from an older iframe are never accepted.
  const frameId = useMemo(
    () => `${screen.id}~${state}~${Math.random().toString(36).slice(2, 8)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screen.id, state, reloadKey],
  );
  const src = frameUrl(origin, screen.path, frameId, state);
  const ref = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    if (!host) return;
    host.register(frameId, { screen: screen.id, state, path: screen.path }, ref.current);
    useUi.getState().setStatus(`${screen.id}:${state}`, 'loading');
    const off = host.subscribe((f, m) => {
      if (f.frameId === frameId && m.fc === 'ready') readyRef.current();
    });
    return () => {
      off();
      host.unregister(frameId);
    };
  }, [host, frameId, screen.id, state, screen.path]);
  return (
    <iframe
      ref={ref}
      key={frameId}
      name={WINDOW_NAME_PREFIX + frameId}
      title={`${screen.title}, ${state} state`}
      src={src}
      width={device.w}
      height={device.h}
      onLoad={() => setTimeout(() => readyRef.current(), READY_FALLBACK_MS)}
      style={{ border: 0, display: 'block', pointerEvents: interactive ? 'auto' : 'none', background: '#fff' }}
    />
  );
}

export interface DeviceFrameProps {
  screen: Screen;
  state: string;
  device: Device;
  origin: string;
  live: boolean;
  interactive: boolean;
  active?: boolean;
  reloadKey?: number;
}

/** Device chrome (status bar, island, home bar) around a w×h screen slot. Shared by board frames and the play stage. */
export function DeviceShell({
  device,
  active,
  screenRef,
  children,
  className = '',
}: {
  device: Device;
  active?: boolean;
  screenRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
  className?: string;
}) {
  const ins = chromeInsets(device);
  return (
    <div className={`fc-device ${device.chrome} ${active ? 'active' : ''} ${className}`} style={{ padding: ins.side }}>
      {device.chrome !== 'none' && (
        <div className="fc-statusbar" style={{ blockSize: ins.top, fontSize: device.chrome === 'android' ? 13 : 16 }}>
          {device.chrome === 'ios' ? <StatusBar /> : <span>9:41</span>}
        </div>
      )}
      <div ref={screenRef} style={{ inlineSize: device.w, blockSize: device.h, position: 'relative', overflow: 'hidden' }}>
        {children}
      </div>
      {device.chrome !== 'none' && (
        <div className="fc-homebar" style={{ blockSize: ins.bottom }}>
          {device.chrome === 'ios' && <span />}
        </div>
      )}
    </div>
  );
}

function DeviceFrameImpl({ screen, state, device, origin, live, interactive, active, reloadKey = 0 }: DeviceFrameProps) {
  const ins = chromeInsets(device);
  const [mounted, setMounted] = useState(live);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (live) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => (setMounted(false), setReady(false)), FADE_MS + 10);
    return () => clearTimeout(t);
  }, [live]);
  useEffect(() => setReady(false), [reloadKey, screen.id, state]);
  const showStill = !live || !ready;
  const still = useStill(screen.id, state, device.id);
  const screenStyle: CSSProperties = { inlineSize: device.w, blockSize: device.h, position: 'relative' };
  return (
    <div className={`fc-device ${device.chrome} ${active ? 'active' : ''}`} style={{ padding: ins.side }}>
      {device.chrome !== 'none' && (
        <div className="fc-statusbar" style={{ blockSize: ins.top, fontSize: device.chrome === 'android' ? 13 : 16 }}>
          {device.chrome === 'ios' ? <StatusBar /> : <span>9:41</span>}
        </div>
      )}
      <div style={screenStyle}>
        {mounted && (
          <LiveIframe
            screen={screen}
            state={state}
            device={device}
            origin={origin}
            interactive={interactive}
            reloadKey={reloadKey}
            onReady={() => setReady(true)}
          />
        )}
        <div className={`fc-still ${showStill ? '' : 'gone'} ${still ? 'img' : ''}`} aria-hidden={!showStill}>
          {still ? (
            <img src={still} decoding="async" alt="" draggable={false} width={device.w} height={device.h} />
          ) : (
            <>
              <span style={{ fontWeight: 600, color: '#4b4b4b' }}>{screen.title}</span>
              <span style={{ fontSize: 15 }} className="mono">
                {screen.path}
              </span>
              <span className="bar" />
              <span className="bar" style={{ inlineSize: '45%' }} />
              <span style={{ fontSize: 14, marginBlockStart: 8 }}>{live ? 'Loading…' : 'Zoom in or hover to load'}</span>
            </>
          )}
        </div>
      </div>
      {device.chrome !== 'none' && (
        <div className="fc-homebar" style={{ blockSize: ins.bottom }}>
          {device.chrome === 'ios' && <span />}
        </div>
      )}
    </div>
  );
}

export const DeviceFrame = memo(DeviceFrameImpl);
