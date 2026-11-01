import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge as RfEdge, type EdgeProps } from '@xyflow/react';
import type { Edge } from '@flowcanvas/config';
import { edgeMeta } from '@/lib/canvas/player';
import { useUi } from '@/store/ui';

export type FlowEdgeType = RfEdge<{ edge: Edge; unsaved: boolean }, 'flow'>;

/**
 * Kind is never colour alone (SC 1.4.1): happy = solid grey, error = red +
 * dash-dot + "error" in the pill, alternate = dashed. Selected = blue.
 * Unsaved (not yet exported) happy edges are drawn dashed lightly.
 */
export function edgeStroke(kind: Edge['kind'], selected: boolean, unsaved: boolean): { stroke: string; strokeDasharray?: string } {
  const dash = kind === 'error' ? '9 4 2 4' : kind === 'alternate' ? '7 5' : unsaved && !selected ? '5 4' : undefined;
  const stroke = selected ? '#3B82F6' : kind === 'error' ? '#DC2626' : '#9A9A9A';
  return dash ? { stroke, strokeDasharray: dash } : { stroke };
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
    borderRadius: 14,
    offset: 40,
  });
  const selected = useUi((s) => s.selectedEdge === e.id);
  const st = edgeStroke(e.kind, selected, p.data!.unsaved);
  const pos = `translate(-50%, -50%) translate(${lx}px, ${ly}px)`;
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={{ ...st, strokeWidth: selected ? 3 : 2 }} interactionWidth={24} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`fc-pill nodrag nopan ${selected ? 'selected' : ''} ${e.kind === 'error' ? 'error' : ''}`}
          style={{ transform: pos, ['--fc-pill-pos' as string]: pos }}
          onClick={() => useUi.getState().set({ selectedEdge: e.id, selectedFrame: null, tokensOpen: false })}
          aria-label={`Edge ${e.trigger.label || 'untitled'}, ${e.kind}, ${edgeMeta(e)}`}
        >
          <div className="label">
            {e.kind === 'error' && <span style={{ color: 'var(--fc-red)' }}>error · </span>}
            {e.kind === 'alternate' && <span style={{ color: 'var(--fc-muted)' }}>alt · </span>}
            {e.trigger.label || 'Untitled'}
          </div>
          <div className="meta tnum">{edgeMeta(e)}</div>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
