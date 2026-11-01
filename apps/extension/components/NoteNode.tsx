/**
 * Sticky note (feature 10): markdown text, resizable, 5 kinds with a colour
 * and a word label, attachable to a frame / edge / section / image.
 * Keyboard: Enter edits, Escape or Ctrl/Cmd+Enter finishes, Delete removes,
 * Shift+Alt+arrows resize (arrows move it, like any node).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { NOTE_KINDS, type Device, type Note } from '@flowcanvas/config';
import { toRef } from '@/lib/canvas/geometry';
import { NOTE_KIND_META, attachTargets, type NoteKind } from '@/lib/canvas/notes';
import { markdownText } from '@/lib/canvas/markdown';
import { deleteNote, updateNote } from '@/lib/canvas/boardActions';
import { useProject } from '@/store/project';
import { useBoard } from '@/store/board';
import { Markdown } from './Markdown';
import './board.css';

export type NoteNodeData = { note: Note; attachedLabel: string | null; device: Device };
export type NoteNodeType = Node<NoteNodeData, 'note'>;

const MIN = { w: 140, h: 80 };

function AttachMenu({ note, onClose }: { note: Note; onClose: () => void }) {
  const config = useProject((s) => s.config);
  const targets = attachTargets(config);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const cur = note.attachTo ? `${note.attachTo.type}|${note.attachTo.id}` : '';
  return (
    <div className="nodrag nopan" style={{ padding: '4px 10px 8px', fontSize: 13 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontWeight: 600 }}>Attach to</span>
        <select
          ref={ref}
          value={cur}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          onChange={(e) => {
            const v = e.target.value;
            const [type, ...rest] = v.split('|');
            updateNote(note.id, (n) => ({ ...n, attachTo: v ? { type: type as 'frame', id: rest.join('|') } : null }));
            onClose();
          }}
          style={{ font: 'inherit', maxInlineSize: '100%', minBlockSize: 24 }}
        >
          <option value="">Not attached</option>
          {targets.map((t) => (
            <option key={`${t.type}|${t.id}`} value={`${t.type}|${t.id}`}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function NoteNodeImpl({ data, selected }: NodeProps<NoteNodeType>) {
  const { note } = data;
  const meta = NOTE_KIND_META[note.kind as NoteKind];
  const editingId = useBoard((s) => s.editingNote);
  const editing = editingId === note.id;
  const [draft, setDraft] = useState(note.text);
  const [attach, setAttach] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(note.text);
  }, [note.text, editing]);
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const finish = () => {
    if (draft !== note.text) updateNote(note.id, (n) => ({ ...n, text: draft }));
    useBoard.getState().set({ editingNote: null });
  };
  const resize = (dw: number, dh: number) =>
    updateNote(note.id, (n) => ({ ...n, rect: { ...n.rect, w: Math.max(MIN.w, n.rect.w + dw), h: Math.max(MIN.h, n.rect.h + dh) } }));
  return (
    <>
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={MIN.w}
        minHeight={MIN.h}
        color="#3B82F6"
        onResizeEnd={(_, p) => {
          const at = toRef({ x: p.x, y: p.y }, data.device);
          updateNote(note.id, (n) => ({ ...n, rect: { x: at.x, y: at.y, w: Math.round(p.width), h: Math.round(p.height) } }));
        }}
      />
      <div
        className="fc-note"
        style={{ ['--note-bg' as string]: meta.bg, ['--note-line' as string]: meta.line, ['--note-ink' as string]: meta.ink }}
        onDoubleClick={() => useBoard.getState().set({ editingNote: note.id })}
      >
        <div className="fc-note-head">
          <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 2, background: meta.ink }} />
          <select
            className="nodrag"
            aria-label="Note kind"
            value={note.kind}
            onChange={(e) => updateNote(note.id, (n) => ({ ...n, kind: e.target.value as NoteKind }))}
          >
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {NOTE_KIND_META[k].label}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="nodrag"
            aria-expanded={attach}
            aria-label={note.attachTo ? 'Change attachment' : 'Attach note'}
            title="Attach to a frame, edge, section or image"
            onClick={() => setAttach((a) => !a)}
          >
            Attach
          </button>
          <button type="button" className="nodrag" aria-label="Delete note" title="Delete note" onClick={() => deleteNote(note.id)}>
            ×
          </button>
        </div>
        {attach && <AttachMenu note={note} onClose={() => setAttach(false)} />}
        {(data.attachedLabel || note.author === 'claude') && !attach && (
          <p className="truncate" title={data.attachedLabel ? `Attached to ${data.attachedLabel}` : undefined} style={{ fontSize: 12, color: 'var(--note-ink)', paddingInline: 10 }}>
            {note.author === 'claude' && <span className="fc-claude-badge" style={{ marginInlineEnd: 6 }}>Claude</span>}
            {data.attachedLabel && <span style={{ opacity: 0.85 }}>Attached to {data.attachedLabel}</span>}
          </p>
        )}
        <div className="fc-note-body">
          {editing ? (
            <textarea
              ref={area}
              className="nodrag nowheel"
              aria-label="Note text (markdown)"
              value={draft}
              placeholder="Write in markdown: **bold**, *italic*, `code`, - lists, [links](https://…)"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  finish();
                }
              }}
            />
          ) : note.text ? (
            <div className="nowheel">
              <Markdown text={note.text} />
            </div>
          ) : (
            <p className="placeholder">Empty note. Double-click or press Enter to write.</p>
          )}
        </div>
      </div>
      <NoteKeys note={note} selected={!!selected} editing={editing} onResize={resize} />
    </>
  );
}

/** Keyboard for a selected note (the RF node wrapper has focus). */
function NoteKeys({ note, selected, editing, onResize }: { note: Note; selected: boolean; editing: boolean; onResize: (dw: number, dh: number) => void }) {
  useEffect(() => {
    if (!selected || editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.classList.contains('react-flow__node-note') || el.dataset.id !== note.id) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        useBoard.getState().set({ editingNote: note.id });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNote(note.id);
      } else if (e.shiftKey && e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        e.stopPropagation();
        const d = 16;
        onResize(e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0, e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, editing, note.id, onResize]);
  return null;
}

export const NoteNode = memo(NoteNodeImpl);

export function noteAriaLabel(n: Note): string {
  return `${NOTE_KIND_META[n.kind as NoteKind].label} note${n.author === 'claude' ? ' by Claude' : ''}: ${markdownText(n.text).slice(0, 120) || 'empty'}`;
}
