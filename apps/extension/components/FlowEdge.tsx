import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge as RfEdge, type EdgeProps } from '@xyflow/react';
import type { Edge } from '@flowcanvas/config';
import { useUi } from '@/store/ui';

export type FlowEdgeType = RfEdge<{ edge: Edge }, 'flow'>;

/** Kind is never color alone (SC 1.4.1): happy solid, error red + dash-dot + "error" text, alternate dashed. */
export function edgeStroke(kind: Edge['kind']): { stroke: string; strokeDasharray?: string } {
  if (kind === 'error') return { stroke: '#dc2626', strokeDasharray: '10 5 2 5' };
  if (kind === 'alternate') return { stroke: '#4b5563', strokeDasharray: '8 6' };
  return { stroke: '#111827' };
}

export function edgeMeta(e: Edge): string {
  return [e.trigger.gesture, e.transition.type, `${e.transition.duration}ms`].join(' · ');
}

function FlowEdgeImpl(p: EdgeProps<FlowEdgeType>) {
  const e = p.data!.edge;
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
    borderRadius: 16,
    offset: 32,
  });
  const st = edgeStroke(e.kind);
  const selected = useUi((s) => s.selectedEdge === e.id);
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={{ ...st, strokeWidth: selected ? 4 : 2.5 }} interactionWidth={24} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`fc-pill nodrag nopan ${selected ? 'selected' : ''} ${e.kind === 'error' ? 'error' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          onClick={() => useUi.getState().set({ selectedEdge: e.id, selectedFrame: null })}
          aria-label={`Edge ${e.trigger.label || 'untitled'}, ${e.kind}, ${edgeMeta(e)}`}
        >
          <div style={{ fontWeight: 600 }}>
            {e.kind === 'error' && <span style={{ color: '#b91c1c' }}>error · </span>}
            {e.kind === 'alternate' && <span style={{ color: '#4b5563' }}>alt · </span>}
            {e.trigger.label || 'Untitled'}
          </div>
          <div className="meta">{edgeMeta(e)}</div>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
