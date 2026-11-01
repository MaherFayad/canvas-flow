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
import { selectLive } from '@/lib/canvas/live';
import { slot, toRef } from '@/lib/canvas/geometry';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { FrameNode, type FrameNodeType } from './FrameNode';
import { SectionNode, type SectionNodeType } from './SectionNode';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';
import { EdgePanel } from './EdgePanel';

const nodeTypes = { frame: FrameNode, section: SectionNode };
const edgeTypes = { flow: FlowEdge };

type AnyNode = FrameNodeType | SectionNodeType;

const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

export function Canvas() {
  const config = useProject((s) => s.config);
  const origin = useUi((s) => s.origin);
  const deviceId = useUi((s) => s.deviceId);
  const live = useUi((s) => s.live);
  const forced = useUi((s) => s.forced);
  const selectedEdgeId = useUi((s) => s.selectedEdge);
  const device = deviceById(config.devices, deviceId);
  const layout = useMemo(() => layoutFrames(config, device), [config, device]);
  const rf = useReactFlow();

  /* ---------- nodes (controlled, measured/selection kept across rebuilds) ---------- */
  const derived = useMemo<AnyNode[]>(() => {
    const screens = new Map(config.screens.map((s) => [s.id, s]));
    const sections: SectionNodeType[] = layout.sections.map((s) => ({
      id: `section:${s.id}`,
      type: 'section',
      position: { x: s.x, y: s.y },
      data: { title: s.title, color: s.color, count: s.count, w: s.w, h: s.h },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const frames: FrameNodeType[] = layout.frames.map((f, i) => ({
      id: f.key,
      type: 'frame',
      position: { x: f.x, y: f.y },
      dragHandle: '.fc-drag',
      ariaLabel: `${screens.get(f.screenId)?.title ?? f.screenId}, ${f.state} state, ${i + 1} of ${layout.frames.length}`,
      data: {
        screen: screens.get(f.screenId)!,
        state: f.state,
        device,
        live: live.has(f.key),
        origin,
        index: i,
        total: layout.frames.length,
      },
    }));
    return [...sections, ...frames];
  }, [config.screens, layout, device, live, origin]);

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
          const sl = slot(device);
          const rowStart = { x: ch.position.x - f.stateIndex * sl.w, y: ch.position.y };
          useProject.getState().moveScreen(f.screenId, toRef(rowStart, device));
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
  const edges = useMemo<FlowEdgeType[]>(
    () =>
      config.edges.map((e) => ({
        id: e.id,
        type: 'flow',
        source: frameKey(e.from.screen, e.from.state),
        target: frameKey(e.to.screen, e.to.state),
        data: { edge: e },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: e.kind === 'error' ? '#dc2626' : '#111827' },
        selected: e.id === selectedEdgeId,
      })),
    [config.edges, selectedEdgeId],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const [fs, fst] = splitKey(c.source);
      const [ts, tst] = splitKey(c.target);
      if (!fs || !ts || c.source === c.target) return;
      const e = useProject.getState().addEdge({ from: { screen: fs, state: fst }, to: { screen: ts, state: tst } });
      useUi.getState().set({ selectedEdge: e.id, selectedFrame: null, announce: 'Edge added. Set its trigger in the side panel.' });
    },
    [],
  );

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

  /* ---------- fit on first content ---------- */
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !layout.frames.length) return;
    fitted.current = true;
    requestAnimationFrame(() => void rf.fitView({ padding: 0.15, maxZoom: 1 }));
  }, [layout.frames.length, rf]);

  const selectedEdge = config.edges.find((e) => e.id === selectedEdgeId) ?? null;

  return (
    <div className="relative h-full w-full">
      <ReactFlow<AnyNode, FlowEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgeClick={(_, e) => useUi.getState().set({ selectedEdge: e.id, selectedFrame: null })}
        onPaneClick={() => useUi.getState().set({ selectedEdge: null })}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements={false}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        nodesFocusable
        edgesFocusable
        zoomOnDoubleClick={false}
        style={{ background: 'var(--fc-bg)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1.5} color="#cbd5e1" />
        <MiniMap pannable zoomable nodeColor={(n: Node) => (n.type === 'section' ? 'rgba(148,163,184,0.25)' : '#94a3b8')} ariaLabel="Minimap" />
        <Controls showInteractive={false} aria-label="Zoom controls" />
      </ReactFlow>
      {selectedEdge && <EdgePanel edge={selectedEdge} />}
      {!config.screens.length && <EmptyState />}
    </div>
  );
}

function EmptyState() {
  const discovery = useUi((s) => s.discovery);
  const origin = useUi((s) => s.origin);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow">
        <h2 className="mb-2 text-lg font-semibold">No screens yet</h2>
        <p className="text-[14px] text-gray-600">
          {!origin
            ? 'Enter your localhost origin in the top bar to start.'
            : discovery?.running
              ? `Discovering screens on ${origin}… ${discovery.done} found`
              : discovery?.note ?? 'Import a flowcanvas.config.json, or run Discover.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="fc-btn" onClick={() => useUi.getState().set({ importOpen: true })}>
            Import config
          </button>
        </div>
      </div>
    </div>
  );
}

export function splitKey(key: string | null | undefined): [string | undefined, string] {
  if (!key) return [undefined, 'default'];
  const i = key.indexOf(':');
  return i < 0 ? [key, 'default'] : [key.slice(0, i), key.slice(i + 1)];
}
