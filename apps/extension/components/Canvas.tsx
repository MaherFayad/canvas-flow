import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Connection,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { frameKey } from '@flowcanvas/config';
import { layoutFrames } from '@/lib/canvas/layout';
import { MAX_LIVE, MIN_LIVE_ZOOM, selectLive } from '@/lib/canvas/live';
import { SECTION_TITLE_H, slot, toRef } from '@/lib/canvas/geometry';
import { CAMERA_MS, SNAPPY, bezierFn, prefersReducedMotion } from '@/lib/canvas/easing';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { FrameNode, type FrameNodeType } from './FrameNode';
import { SectionNode, type SectionNodeType } from './SectionNode';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';

const nodeTypes = { frame: FrameNode, section: SectionNode };
const edgeTypes = { flow: FlowEdge };
type AnyNode = FrameNodeType | SectionNodeType;

const snappy = bezierFn(SNAPPY);
/** Camera moves: 450 ms Snappy, interruptible (d3 transitions restart from the current transform). */
export const camera = () => ({ duration: prefersReducedMotion() ? 0 : CAMERA_MS, ease: snappy, interpolate: 'linear' as const });

const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

export function Canvas() {
  const config = useProject((s) => s.config);
  const saved = useProject((s) => s.saved);
  const origin = useUi((s) => s.origin);
  const deviceId = useUi((s) => s.deviceId);
  const live = useUi((s) => s.live);
  const forced = useUi((s) => s.forced);
  const sdk = useUi((s) => s.sdk);
  const selectedEdgeId = useUi((s) => s.selectedEdge);
  const device = deviceById(config.devices, deviceId);
  const layout = useMemo(() => layoutFrames(config, device), [config, device]);
  const rf = useReactFlow();

  /* ---------- nodes (controlled; measured/selection kept across rebuilds) ---------- */
  const derived = useMemo<AnyNode[]>(() => {
    const screens = new Map(config.screens.map((s) => [s.id, s]));
    const sdkScreens = new Set(Object.keys(sdk).filter((k) => sdk[k]).map((k) => k.split(':')[0]));
    const sections: SectionNodeType[] = layout.sections.map((s) => ({
      id: `section:${s.id}`,
      type: 'section',
      position: { x: s.x, y: s.y + SECTION_TITLE_H - 72 },
      data: { title: s.title, count: s.count },
      draggable: false,
      selectable: false,
      focusable: false,
    }));
    const frames: FrameNodeType[] = layout.frames.map((f, i) => {
      const screen = screens.get(f.screenId)!;
      return {
        id: f.key,
        type: 'frame',
        position: { x: f.x, y: f.y },
        dragHandle: '.fc-drag',
        ariaLabel: `${screen.title}, ${f.state} state, ${i + 1} of ${layout.frames.length}`,
        data: {
          screen,
          state: f.state,
          device,
          live: live.has(f.key),
          origin,
          missing: f.stateIndex > 0 && !config.mocks[f.key] && !sdkScreens.has(f.screenId),
        },
      };
    });
    return [...sections, ...frames];
  }, [config.screens, config.mocks, layout, device, live, origin, sdk]);

  const [nodes, setNodes] = useState<AnyNode[]>(derived);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return derived.map((n) => {
        const o = old.get(n.id);
        return o ? ({ ...n, selected: o.selected, measured: o.measured } as AnyNode) : n;
      });
    });
  }, [derived]);

  const onNodesChange = useCallback(
    (changes: NodeChange<AnyNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging === false && ch.position) {
          const f = layout.frames.find((x) => x.key === ch.id);
          if (!f) continue;
          const top = { x: ch.position.x, y: ch.position.y - f.stateIndex * slot(device).h };
          useProject.getState().moveScreen(f.screenId, toRef(top, device));
        }
        if (ch.type === 'select') {
          const ui = useUi.getState();
          if (ch.selected) {
            const n = derived.find((x) => x.id === ch.id);
            ui.set({ selectedFrame: ch.id, selectedEdge: null, announce: n?.ariaLabel ?? '' });
          } else if (ui.selectedFrame === ch.id) ui.set({ selectedFrame: null });
        }
      }
    },
    [layout, device, derived],
  );

  /* ---------- edges ---------- */
  const savedEdges = useMemo(() => new Map(saved.edges.map((e) => [e.id, JSON.stringify(e)])), [saved.edges]);
  const edges = useMemo<FlowEdgeType[]>(
    () =>
      config.edges.map((e) => {
        const sel = e.id === selectedEdgeId;
        return {
          id: e.id,
          type: 'flow',
          source: frameKey(e.from.screen, e.from.state),
          target: frameKey(e.to.screen, e.to.state),
          data: { edge: e, unsaved: savedEdges.get(e.id) !== JSON.stringify(e) },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: sel ? '#3B82F6' : e.kind === 'error' ? '#DC2626' : '#9A9A9A' },
          selected: sel,
          zIndex: sel ? 10 : 0,
        };
      }),
    [config.edges, selectedEdgeId, savedEdges],
  );

  const onConnect = useCallback((c: Connection) => {
    const [fs, fst] = splitKey(c.source);
    const [ts, tst] = splitKey(c.target);
    if (!fs || !ts || c.source === c.target) return;
    const e = useProject.getState().addEdge({ from: { screen: fs, state: fst }, to: { screen: ts, state: tst } });
    useUi.getState().set({ selectedEdge: e.id, selectedFrame: null, tokensOpen: false, announce: 'Edge added. Set its trigger in the side panel.' });
  }, []);

  /* ---------- live / still ---------- */
  const transform = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const lastLive = useRef(new Map<string, number>());
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const [tx, ty, zoom] = transform;
      if (!width || !height) return;
      const view = { x: -tx / zoom, y: -ty / zoom, w: width / zoom, h: height / zoom };
      const next = selectLive({ frames: layout.frames, view, zoom, forced, lastLive: lastLive.current });
      const now = performance.now();
      for (const k of next) lastLive.current.set(k, now);
      if (!setsEqual(next, useUi.getState().live)) useUi.getState().set({ live: next });
    });
    return () => cancelAnimationFrame(raf);
  }, [transform, width, height, layout, forced]);

  useEffect(() => {
    const w = window as unknown as { __fc?: Record<string, unknown> };
    if (w.__fc) w.__fc.rf = rf;
  }, [rf]);

  /* ---------- fit on first content ---------- */
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !layout.frames.length) return;
    fitted.current = true;
    // Open on the first section's default row, like the reference (frame_62),
    // instead of fitting every state of every screen into a tiny column.
    const heads = layout.frames.filter((f) => f.stateIndex === 0);
    const top = Math.min(...heads.map((f) => f.y));
    const firstRow = heads.filter((f) => f.y === top).map((f) => ({ id: f.key }));
    requestAnimationFrame(() => void rf.fitView({ padding: 0.18, maxZoom: 0.65, ...(firstRow.length ? { nodes: firstRow } : {}) }));
  }, [layout.frames.length, rf]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow<AnyNode, FlowEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgeClick={(_, e) => useUi.getState().set({ selectedEdge: e.id, selectedFrame: null, tokensOpen: false })}
        onPaneClick={() => useUi.getState().set({ selectedEdge: null })}
        minZoom={0.05}
        maxZoom={2}
        panOnScroll
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        connectionLineStyle={{ stroke: '#3B82F6', strokeWidth: 2 }}
        style={{ background: 'var(--fc-board)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#dcdcdc" />
        <MiniMap
          pannable
          zoomable
          ariaLabel="Minimap"
          style={{ inlineSize: 150, blockSize: 100 }}
          maskColor="rgba(237,237,237,0.6)"
          nodeColor={(n: Node) => (n.type === 'section' ? 'transparent' : '#cfcfcf')}
        />
        <Controls showInteractive={false} position="bottom-left" aria-label="Zoom controls" fitViewOptions={{ padding: 0.12, ...camera() }} />
      </ReactFlow>
      <StatusPill />
      {!config.screens.length && <EmptyState />}
    </div>
  );
}

/** Bottom-centre status pill: zoom band · live count · record · reset layout. */
function StatusPill() {
  const zoom = useStore((s) => s.transform[2]);
  const live = useUi((s) => s.live.size);
  const recording = useUi((s) => s.recording);
  const rf = useReactFlow();
  const sep = <span style={{ color: 'var(--fc-faint)' }}>·</span>;
  return (
    <div
      role="status"
      className="tnum absolute bottom-3 start-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#e6e6e6] bg-white px-3"
      style={{ fontSize: 10, color: 'var(--fc-muted)', minBlockSize: 26 }}
    >
      <span>zoom: {zoom >= MIN_LIVE_ZOOM ? 'near' : 'far'}</span>
      {sep}
      <span>
        live: {live}/{MAX_LIVE}
      </span>
      {sep}
      <span>Screenshots arrive in M5</span>
      {sep}
      <button
        className="fc-btn"
        style={{ fontSize: 10, paddingInline: 4, color: recording ? 'var(--fc-red)' : 'var(--fc-ink)' }}
        aria-pressed={recording}
        onClick={() => useUi.getState().set({ recording: !recording, announce: recording ? 'Recording off' : 'Recording on' })}
      >
        {recording ? '● Recording (R)' : 'Record (R)'}
      </button>
      {sep}
      <button
        className="fc-btn"
        style={{ fontSize: 10, paddingInline: 4 }}
        onClick={() => {
          useProject.getState().update((c) => ({ ...c, screens: c.screens.map(({ position: _p, ...s }) => s) }));
          requestAnimationFrame(() => void rf.fitView({ padding: 0.12, ...camera() }));
        }}
      >
        Reset layout
      </button>
    </div>
  );
}

function EmptyState() {
  const discovery = useUi((s) => s.discovery);
  const origin = useUi((s) => s.origin);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto max-w-sm rounded-lg border border-[#e6e6e6] bg-white p-5 text-center" style={{ fontSize: 12 }}>
        <h2 className="mb-1 font-semibold" style={{ fontSize: 13 }}>
          No screens yet
        </h2>
        <p style={{ color: 'var(--fc-muted)' }}>
          {!origin
            ? 'Enter your localhost origin in the top bar to start.'
            : discovery?.running
              ? `Discovering screens on ${origin}… ${discovery.done} found`
              : (discovery?.note ?? 'Import a flowcanvas.config.json to start.')}
        </p>
        <button className="fc-btn primary mt-3" onClick={() => useUi.getState().set({ importOpen: true })}>
          Import config
        </button>
      </div>
    </div>
  );
}

export function splitKey(key: string | null | undefined): [string | undefined, string] {
  if (!key) return [undefined, 'default'];
  const i = key.indexOf(':');
  return i < 0 ? [key, 'default'] : [key.slice(0, i), key.slice(i + 1)];
}
