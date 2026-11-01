import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';

export type SectionNodeData = { title: string; count: number };
export type SectionNodeType = Node<SectionNodeData, 'section'>;

/** Section title floating above its frames: "Onboarding" + muted "3 steps" (UI_REFERENCE Canvas mode). */
function SectionNodeImpl({ data }: NodeProps<SectionNodeType>) {
  return (
    <div role="heading" aria-level={2} style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 30, fontWeight: 600, color: 'var(--fc-ink)' }}>{data.title}</span>
      <span style={{ fontSize: 20, color: 'var(--fc-muted)' }}>
        {data.count} {data.count === 1 ? 'step' : 'steps'}
      </span>
    </div>
  );
}

export const SectionNode = memo(SectionNodeImpl);
