import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { SECTION_TINT } from '@/lib/canvas/badges';
import { SECTION_TITLE_H } from '@/lib/canvas/geometry';

export type SectionNodeData = { title: string; color: string; count: number; w: number; h: number };
export type SectionNodeType = Node<SectionNodeData, 'section'>;

function SectionNodeImpl({ data }: NodeProps<SectionNodeType>) {
  const tint = SECTION_TINT[data.color] ?? SECTION_TINT.grey!;
  return (
    <div
      role="group"
      aria-label={`Section ${data.title}, ${data.count} screens`}
      style={{
        inlineSize: data.w,
        blockSize: data.h,
        background: tint.bg,
        border: `2px solid ${tint.border}`,
        borderRadius: 28,
      }}
    >
      <div
        style={{ blockSize: SECTION_TITLE_H, display: 'flex', alignItems: 'center', gap: 12, paddingInline: 24, color: tint.fg }}
      >
        <span style={{ fontSize: 26, fontWeight: 700 }}>{data.title}</span>
        <span style={{ fontSize: 18, opacity: 0.8 }}>
          {data.count} {data.count === 1 ? 'screen' : 'screens'}
        </span>
        <span style={{ fontSize: 14, opacity: 0.7, marginInlineStart: 'auto' }}>{data.color}</span>
      </div>
    </div>
  );
}

export const SectionNode = memo(SectionNodeImpl);
