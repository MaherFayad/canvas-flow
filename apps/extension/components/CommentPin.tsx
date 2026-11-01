/**
 * Comment pins on frames (feature 10), the "Changed by Claude" flag, and the
 * composer that opens after dropping a pin in comment mode (C).
 * Pins and flags keep a constant on-screen size whatever the zoom.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useStore, type Node, type NodeProps } from '@xyflow/react';
import type { Comment } from '@flowcanvas/config';
import { addComment } from '@/lib/canvas/boardActions';
import { mentionsClaude } from '@/lib/canvas/comments';
import { useBoard } from '@/store/board';
import './board.css';

export type PinNodeData = { comment: Comment; n: number; stale: boolean; frameLabel: string };
export type PinNodeType = Node<PinNodeData, 'pin'>;
export type FlashNodeData = { label: string };
export type FlashNodeType = Node<FlashNodeData, 'flash'>;

const useInverseZoom = () => useStore((s) => 1 / Math.max(0.05, s.transform[2]));

function PinNodeImpl({ data }: NodeProps<PinNodeType>) {
  const { comment, n, stale } = data;
  const k = useInverseZoom();
  const active = useBoard((s) => s.commentId === comment.id && s.panel === 'comments');
  const resolved = comment.status === 'resolved';
  const label = `Comment ${n} on ${data.frameLabel}${resolved ? ', resolved' : ''}${comment.to === 'claude' ? ', for Claude' : ''}${stale ? ', element moved or removed' : ''}: ${comment.thread[0]?.text ?? ''}`;
  return (
    <div className={`fc-pin ${resolved ? 'resolved' : ''} ${stale ? 'stale' : ''} ${active ? 'active' : ''}`} style={{ transform: `scale(${k})` }}>
      <button
        type="button"
        className="dot nodrag"
        aria-label={label}
        title={stale ? 'Element moved or removed' : comment.thread[0]?.text}
        onClick={(e) => {
          e.stopPropagation();
          useBoard.getState().set({ panel: 'comments', commentId: comment.id });
        }}
      >
        {resolved ? '✓' : n}
      </button>
      {stale && <span className="tag">Element moved or removed</span>}
      {!stale && comment.to === 'claude' && !resolved && <span className="tag">For Claude</span>}
    </div>
  );
}
export const PinNode = memo(PinNodeImpl);

function FlashNodeImpl({ data }: NodeProps<FlashNodeType>) {
  const k = useInverseZoom();
  return (
    <div className="fc-flash" aria-hidden style={{ transform: `translateY(-100%) scale(${k})` }}>
      {data.label}
    </div>
  );
}
export const FlashNode = memo(FlashNodeImpl);

/** Popover after a pin drop: text, "For Claude" toggle, Post. */
export function CommentComposer() {
  const composer = useBoard((s) => s.composer);
  const [text, setText] = useState('');
  const [forClaude, setForClaude] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (composer) {
      setText('');
      setForClaude(false);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [composer?.frame, composer?.x, composer?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!composer) return null;
  const close = () => useBoard.getState().set({ composer: null });
  const post = () => {
    const t = text.trim();
    if (!t || composer.reading) return;
    const cm = addComment({ frame: composer.frame, device: composer.device, x: composer.x, y: composer.y, element: composer.element, text: t, forClaude });
    useBoard.getState().set({ composer: null, panel: 'comments', commentId: cm.id });
  };
  const claude = forClaude || mentionsClaude(text);
  const el = composer.element;
  return (
    <div
      className="fc-popover nodrag nopan"
      role="dialog"
      aria-label="New comment"
      style={{ insetInlineStart: composer.at.x + 14, insetBlockStart: composer.at.y - 10 }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
      }}
    >
      <p className="mono truncate" style={{ color: 'var(--fc-muted)', marginBlockEnd: 6 }} title={el?.selector}>
        {composer.reading ? 'Reading the element under the pin…' : el ? `${el.selector}${el.text ? ` · "${el.text.slice(0, 40)}"` : ''}` : 'Spot on the frame (no element: the frame was not live)'}
      </p>
      <label className="sr-only" htmlFor="fc-comment-text">
        Comment
      </label>
      <textarea id="fc-comment-text" ref={ref} value={text} placeholder="Leave a comment. @claude sends it to Claude." onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1.5" style={{ minBlockSize: 24 }}>
          <input type="checkbox" checked={claude} disabled={mentionsClaude(text)} onChange={(e) => setForClaude(e.target.checked)} />
          For Claude
        </label>
        <span className="flex-1" />
        <button className="fc-btn" onClick={close}>
          Cancel
        </button>
        <button className="fc-btn primary" disabled={!text.trim() || !!composer.reading} onClick={post}>
          Post
        </button>
      </div>
    </div>
  );
}
