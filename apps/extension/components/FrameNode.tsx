import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Device, Screen } from '@flowcanvas/config';
import { frameUrl } from '@flowcanvas/protocol';
import { badgeColors } from '@/lib/canvas/badges';
import { HOVER_LIVE_MS } from '@/lib/canvas/live';
import { HEADER_H } from '@/lib/canvas/geometry';
import { useUi } from '@/store/ui';
import { useProject } from '@/store/project';
import { DeviceFrame } from './DeviceFrame';

export type FrameNodeData = {
  screen: Screen;
  state: string;
  device: Device;
  live: boolean;
  origin: string;
  /** Non-default state with no mocks and no SDK seen: drawn as a dashed placeholder. */
  missing: boolean;
};
export type FrameNodeType = Node<FrameNodeData, 'frame'>;

export function StateBadge({ state, size }: { state: string; size?: number }) {
  const b = badgeColors(state);
  return (
    <span className="fc-badge" style={{ background: b.bg, color: b.fg, fontSize: size }}>
      {state}
    </span>
  );
}

function FrameMenu({ screen, state, onReload }: { screen: Screen; state: string; onReload: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const origin = useUi((s) => s.origin);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  const item = 'block w-full text-start px-3 min-h-[26px] text-[12px] hover:bg-[#f2f2f2]';
  const link = frameUrl(origin, screen.path, 'link', state);
  return (
    <div ref={ref} className="nodrag relative">
      <button
        type="button"
        className="fc-btn"
        style={{ fontSize: 16, minBlockSize: 24 }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Frame menu: ${screen.title}, ${state}`}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute z-50 mt-1 min-w-[190px] rounded-lg border border-[#e6e6e6] bg-white py-1 shadow-lg" style={{ insetInlineEnd: 0 }}>
          <button role="menuitem" className={item} onClick={() => (onReload(), setOpen(false))}>
            Reload
          </button>
          <button role="menuitem" className={item} onClick={() => (window.open(link.replace(/[?&]fc-frame=[^&]*/, ''), '_blank'), setOpen(false))}>
            Open in tab
          </button>
          <button role="menuitem" className={item} onClick={() => (void navigator.clipboard?.writeText(link), setOpen(false))}>
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
          <button role="menuitem" className={item + ' text-[#dc2626]'} onClick={() => (setOpen(false), useProject.getState().deleteFrame(screen.id, state))}>
            {screen.states.length > 1 ? 'Delete this state' : 'Delete screen'}
          </button>
        </div>
      )}
    </div>
  );
}

function FrameNodeImpl({ data, selected, id }: NodeProps<FrameNodeType>) {
  const { screen, state, device } = data;
  const recording = useUi((s) => s.recording);
  const status = useUi((s) => s.status[id]);
  const [reloadKey, setReloadKey] = useState(0);
  const [showAnyway, setShowAnyway] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const liveDot = data.live && status === 'ready';
  const placeholder = data.missing && !showAnyway;

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
      <div className="fc-drag flex items-center gap-2" style={{ blockSize: HEADER_H, cursor: 'grab', paddingInline: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }} className="truncate">
          {screen.title}
        </span>
        <span style={{ fontSize: 15, color: 'var(--fc-faint)' }}>· {state}</span>
        <span className="ms-auto flex items-center gap-2">
          <span
            aria-label={liveDot ? 'live' : 'still'}
            title={liveDot ? 'Live' : 'Still'}
            style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: liveDot ? 'var(--fc-green)' : '#d4d4d4', transition: 'background 150ms' }}
          />
          <StateBadge state={state} size={13} />
          <FrameMenu screen={screen} state={state} onReload={() => setReloadKey((k) => k + 1)} />
        </span>
      </div>
      {placeholder ? (
        <button
          type="button"
          className="fc-placeholder nodrag"
          style={{ inlineSize: device.w, blockSize: device.h + 78, borderRadius: device.chrome === 'none' ? 8 : 44 }}
          onClick={() => setShowAnyway(true)}
          aria-label={`No ${state} state for ${screen.title}. Load the frame anyway`}
        >
          <span style={{ fontSize: 40, lineHeight: 1 }}>+</span>
          <span style={{ fontWeight: 600 }}>No {state} state</span>
          <span style={{ fontSize: 14, maxInlineSize: '75%', textAlign: 'center' }}>
            Add mocks for “{screen.id}:{state}”, or handle fc.is('{state}') with the SDK. Click to load anyway.
          </span>
        </button>
      ) : (
        <DeviceFrame screen={screen} state={state} device={device} origin={data.origin} live={data.live} interactive={selected || recording} reloadKey={reloadKey} />
      )}
      <Handle type="target" position={Position.Left} style={{ top: '50%' }} aria-label={`Edge target: ${screen.title} ${state}`} />
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} aria-label={`Start edge from ${screen.title} ${state}`} />
    </div>
  );
}

export const FrameNode = memo(FrameNodeImpl);
