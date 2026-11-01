/**
 * Comments panel (feature 10): threads with filters Open / Resolved / Mine /
 * For Claude; reply, resolve, reopen, edit, delete; Claude's replies carry a
 * Claude badge and link their changes; "Copy as prompt" per thread.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Comment } from '@flowcanvas/config';
import { COMMENT_FILTERS, FILTER_LABEL, ME, commentNumber, filterComments, threadPrompt } from '@/lib/canvas/comments';
import { deleteComment, deleteMessage, editMessage, isClaude, replyComment, setCommentStatus, setForClaude } from '@/lib/canvas/boardActions';
import { canvasApi } from '@/lib/canvas/claudeRequests';
import { useProject } from '@/store/project';
import { useBoard } from '@/store/board';
import { Segmented } from './Segmented';
import { copyText } from './SectionNode';
import './board.css';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function Message({ cm, i }: { cm: Comment; i: number }) {
  const m = cm.thread[i]!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const claude = isClaude(m.author);
  const config = useProject((s) => s.config);
  const nameOf = (id: string) =>
    config.edges.find((e) => e.id === id)
      ? `edge ${id}`
      : (config.screens.find((s) => s.id === id)?.title ?? config.notes.find((n) => n.id === id)?.kind ?? config.images.find((x) => x.id === id)?.caption ?? id);
  return (
    <li className="grid gap-1" style={{ paddingBlock: 4 }}>
      <div className="flex items-center gap-1.5">
        {claude ? <span className="fc-claude-badge">Claude</span> : <strong>{m.author === ME ? 'You' : m.author}</strong>}
        <span className="tnum" style={{ color: 'var(--fc-muted)' }}>
          {when(m.at)}
        </span>
        <span className="flex-1" />
        {!claude && !editing && (
          <>
            <button className="fc-btn" style={{ paddingInline: 4 }} aria-label={`Edit message ${i + 1}`} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="fc-btn" style={{ paddingInline: 4 }} aria-label={`Delete message ${i + 1}`} onClick={() => deleteMessage(cm.id, i)}>
              Delete
            </button>
          </>
        )}
      </div>
      {editing ? (
        <div className="grid gap-1">
          <textarea aria-label="Edit message" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
          <div className="flex justify-end gap-1">
            <button className="fc-btn" onClick={() => (setDraft(m.text), setEditing(false))}>
              Cancel
            </button>
            <button className="fc-btn primary" disabled={!draft.trim()} onClick={() => (editMessage(cm.id, i, draft.trim()), setEditing(false))}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</p>
      )}
      {!!m.changes?.length && (
        <div className="flex flex-wrap items-center gap-1" style={{ color: 'var(--fc-muted)' }}>
          Changed:
          {m.changes.map((id) => (
            <button
              key={id}
              className="fc-btn mono"
              style={{ border: '1px solid var(--fc-line)', paddingInline: 6 }}
              title={`Show ${id} on the canvas`}
              onClick={() => canvasApi.focus?.(id)}
            >
              {nameOf(id)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function Thread({ cm, active }: { cm: Comment; active: boolean }) {
  const config = useProject((s) => s.config);
  const probe = useBoard((s) => s.probes[cm.id]);
  const [reply, setReply] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const n = commentNumber(config, cm.id);
  const [sid, st] = cm.anchor.frame.split(':');
  const screen = config.screens.find((s) => s.id === sid);
  const stale = probe ? !probe.found : false;
  const send = () => {
    const t = reply.trim();
    if (!t) return;
    replyComment(cm.id, t);
    setReply('');
  };
  return (
    <article ref={ref} className={`fc-thread ${active ? 'active' : ''}`} aria-label={`Comment ${n}`} onFocus={() => useBoard.getState().set({ commentId: cm.id })}>
      <header className="flex items-center gap-1.5">
        <button
          className="fc-btn tnum"
          style={{ background: cm.status === 'resolved' ? '#fff' : 'var(--fc-black)', color: cm.status === 'resolved' ? 'var(--fc-muted)' : '#fff', border: '1px solid var(--fc-line)', borderRadius: 12, minInlineSize: 24, paddingInline: 6, fontWeight: 700 }}
          aria-label={`Show comment ${n} on the canvas`}
          onClick={() => canvasApi.focus?.(cm.id)}
        >
          {n}
        </button>
        <span className="truncate" style={{ fontWeight: 600 }}>
          {screen?.title ?? sid} <span style={{ color: 'var(--fc-muted)', fontWeight: 400 }}>· {st}</span>
        </span>
        <span className="flex-1" />
        <span style={{ color: cm.status === 'resolved' ? 'var(--fc-green)' : 'var(--fc-muted)' }}>{cm.status === 'resolved' ? 'Resolved' : 'Open'}</span>
      </header>
      {cm.anchor.element && (
        <p className="mono truncate" style={{ color: 'var(--fc-muted)', marginBlock: 4 }} title={cm.anchor.element.selector}>
          {cm.anchor.element.selector}
        </p>
      )}
      {stale && <p style={{ color: 'var(--fc-orange)' }}>Element moved or removed</p>}
      <ol className="mt-1">
        {cm.thread.map((_, i) => (
          <Message key={i} cm={cm} i={i} />
        ))}
      </ol>
      <div className="mt-2 grid gap-1.5">
        <label className="sr-only" htmlFor={`reply-${cm.id}`}>
          Reply to comment {n}
        </label>
        <textarea
          id={`reply-${cm.id}`}
          value={reply}
          placeholder="Reply…"
          style={{ minBlockSize: 36 }}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && send()}
        />
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1.5" style={{ minBlockSize: 24 }}>
            <input type="checkbox" checked={cm.to === 'claude'} onChange={(e) => setForClaude(cm.id, e.target.checked)} />
            For Claude
          </label>
          <span className="flex-1" />
          <button className="fc-btn" onClick={() => void copyText(threadPrompt(config, cm), 'Thread prompt')}>
            Copy as prompt
          </button>
          {cm.status === 'open' ? (
            <button className="fc-btn" onClick={() => setCommentStatus(cm.id, 'resolved')}>
              Resolve
            </button>
          ) : (
            <button className="fc-btn" onClick={() => setCommentStatus(cm.id, 'open')}>
              Reopen
            </button>
          )}
          <button className="fc-btn danger" onClick={() => deleteComment(cm.id)}>
            Delete
          </button>
          <button className="fc-btn primary" disabled={!reply.trim()} onClick={send}>
            Reply
          </button>
        </div>
      </div>
    </article>
  );
}

export function CommentsPanel() {
  const comments = useProject((s) => s.config.comments);
  const filter = useBoard((s) => s.commentFilter);
  const active = useBoard((s) => s.commentId);
  const shown = useMemo(() => filterComments(comments, filter), [comments, filter]);
  const counts = useMemo(() => Object.fromEntries(COMMENT_FILTERS.map((f) => [f, filterComments(comments, f).length])), [comments]);
  return (
    <aside className="fc-panel" aria-label="Comments" style={{ fontSize: 11, inlineSize: 300 }}>
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 600 }}>
            Comments <span className="tnum" style={{ color: 'var(--fc-muted)', fontWeight: 400 }}>{comments.length}</span>
          </h2>
          <p style={{ color: 'var(--fc-muted)' }}>Press C, then click a spot on a frame to comment.</p>
        </div>
        <button className="fc-btn" aria-label="Close comments" onClick={() => useBoard.getState().set({ panel: null })}>
          ×
        </button>
      </div>
      <div className="px-3 pb-2">
        <Segmented
          label="Filter comments"
          options={COMMENT_FILTERS}
          value={filter}
          render={(f) => `${FILTER_LABEL[f]} ${counts[f] ?? 0}`}
          onChange={(f) => useBoard.getState().set({ commentFilter: f })}
        />
      </div>
      <div style={{ borderBlockStart: '1px solid var(--fc-line)' }}>
        {!shown.length && <p className="px-3 py-3" style={{ color: 'var(--fc-muted)' }}>No {FILTER_LABEL[filter].toLowerCase()} comments.</p>}
        {shown.map((cm) => (
          <Thread key={cm.id} cm={cm} active={cm.id === active} />
        ))}
      </div>
    </aside>
  );
}
