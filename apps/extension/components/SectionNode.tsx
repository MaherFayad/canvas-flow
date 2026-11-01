/**
 * Section (feature 9): a named area holding frames, notes, images and other
 * sections. Header: name, item count, colour with a word label, collapse,
 * lock, menu (fit to content, auto-layout row / grid, copy as prompt, play,
 * ungroup). The body lets clicks through to the canvas; only the header is
 * a drag handle (moving a section moves everything inside).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { SECTION_COLORS } from '@flowcanvas/config';
import { SECTION_COLOR_META, countLabel, type SectionView } from '@/lib/canvas/sections';
import { sectionPrompt } from '@/lib/canvas/comments';
import { fitSection, layoutSection, setSection, toggleCollapse, toggleLock, ungroupSection } from '@/lib/canvas/boardActions';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import './board.css';

export type SectionNodeData = { view: SectionView };
export type SectionNodeType = Node<SectionNodeData, 'section'>;

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    useUi.getState().set({ announce: `${what} copied` });
  } catch {
    useUi.getState().set({ announce: `Could not copy ${what.toLowerCase()}` });
  }
}

function SectionMenu({ v, onClose }: { v: SectionView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as HTMLElement) && onClose();
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);
  const act = (fn: () => void) => () => (fn(), onClose());
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${v.title} menu`}
      className="fc-sec-menu nodrag nopan"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
    >
      <button role="menuitem" onClick={act(() => fitSection(v.id))}>
        Fit to content
      </button>
      <button role="menuitem" disabled={v.locked} onClick={act(() => layoutSection(v.id, 'row'))}>
        Auto-layout: row
      </button>
      <button role="menuitem" disabled={v.locked} onClick={act(() => layoutSection(v.id, 'grid'))}>
        Auto-layout: grid (3 per row)
      </button>
      <hr />
      <button role="menuitem" onClick={act(() => void copyText(sectionPrompt(useProject.getState().config, v.id), 'Section prompt'))}>
        Copy as prompt
      </button>
      <button role="menuitem" onClick={act(() => useUi.getState().set({ mode: 'player', announce: `Playing ${v.title}` }))}>
        Play this flow
      </button>
      <hr />
      <button role="menuitem" disabled={v.locked} onClick={act(() => ungroupSection(v.id))}>
        Ungroup <span style={{ marginInlineStart: 'auto', color: 'var(--fc-faint)', fontSize: 16 }}>⇧⌘G</span>
      </button>
    </div>
  );
}

function SectionNodeImpl({ data }: NodeProps<SectionNodeType>) {
  const v = data.view;
  const meta = SECTION_COLOR_META[v.color];
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(v.title);
  useEffect(() => setTitle(v.title), [v.title]);
  const commit = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== v.title) setSection(v.id, { title: t });
    else setTitle(v.title);
  };
  return (
    <div
      className={`fc-section ${v.collapsed ? 'collapsed' : ''}`}
      style={{ ['--sec-fill' as string]: meta.fill, ['--sec-line' as string]: meta.line }}
      aria-label={`Section ${v.title}, ${countLabel(v)}${v.collapsed ? ', collapsed' : ''}${v.locked ? ', locked' : ''}`}
    >
      <div className={`fc-sec-head ${v.locked ? 'locked' : 'fc-sec-drag'}`}>
        <button
          type="button"
          className="fc-sec-btn nodrag"
          aria-expanded={!v.collapsed}
          aria-label={`${v.collapsed ? 'Expand' : 'Collapse'} ${v.title}`}
          title={v.collapsed ? 'Expand (frames load again)' : 'Collapse (frames unload)'}
          onClick={() => toggleCollapse(v.id)}
          style={{ paddingInline: 8 }}
        >
          <span aria-hidden style={{ display: 'inline-block', transform: v.collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms' }}>
            ▾
          </span>
        </button>
        {editing ? (
          <input
            className="fc-sec-title nodrag"
            aria-label="Section name"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') (setTitle(v.title), setEditing(false));
            }}
            style={{ borderBottom: '2px solid var(--fc-blue)' }}
          />
        ) : (
          <h2 className="fc-sec-title" onDoubleClick={() => !v.locked && setEditing(true)} title="Double-click to rename">
            {v.title}
          </h2>
        )}
        <span className="fc-sec-count tnum">{countLabel(v)}</span>
        <span style={{ flex: 1 }} />
        <label className="fc-sec-btn nodrag" title="Section colour">
          <span className="fc-chip" style={{ background: meta.chip }} aria-hidden />
          <span className="sr-only">Colour</span>
          <select
            aria-label={`${v.title} colour`}
            value={v.color}
            disabled={v.locked}
            onChange={(e) => setSection(v.id, { color: e.target.value as SectionView['color'] })}
            style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          >
            {SECTION_COLORS.map((c) => (
              <option key={c} value={c}>
                {SECTION_COLOR_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="fc-sec-btn nodrag"
          aria-pressed={v.locked}
          title={v.locked ? 'Unlock section' : 'Lock section (no moves or edits)'}
          onClick={() => toggleLock(v.id)}
        >
          {v.locked ? 'Locked' : 'Lock'}
        </button>
        {!editing && !v.locked && (
          <button type="button" className="fc-sec-btn nodrag" aria-label={`Rename ${v.title}`} onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        <button
          type="button"
          className="fc-sec-btn nodrag"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`${v.title} menu`}
          onClick={() => setMenu((m) => !m)}
          style={{ fontSize: 26 }}
        >
          ⋯
        </button>
        {menu && <SectionMenu v={v} onClose={() => setMenu(false)} />}
      </div>
      {/* Edges into a collapsed section attach here. */}
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 44 }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 44 }} />
    </div>
  );
}

export const SectionNode = memo(SectionNodeImpl);
