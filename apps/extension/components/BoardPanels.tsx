/** Right-side panels for M6: Comments, Activity, Image. The edge inspector and Tokens panel take precedence. */
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useBoard } from '@/store/board';
import { ActivityPanel } from './ActivityPanel';
import { CommentsPanel } from './CommentsPanel';
import { ImagePanel } from './ImageNode';

export function BoardPanels() {
  const panel = useBoard((s) => s.panel);
  const imageId = useBoard((s) => s.imageId);
  const mode = useUi((s) => s.mode);
  const edgeOpen = useUi((s) => !!s.selectedEdge) && mode === 'canvas';
  const tokensOpen = useUi((s) => s.tokensOpen);
  const hasImage = useProject((s) => !!imageId && s.config.images.some((i) => i.id === imageId));
  if (edgeOpen || tokensOpen || !panel) return null;
  if (panel === 'comments') return <CommentsPanel />;
  if (panel === 'activity') return <ActivityPanel />;
  if (panel === 'image' && imageId && hasImage && mode === 'canvas') return <ImagePanel key={imageId} id={imageId} />;
  return null;
}

/** Top-bar "Comments" toggle with the open count. */
export function CommentsButton() {
  const open = useProject((s) => s.config.comments.filter((c) => c.status === 'open').length);
  const panel = useBoard((s) => s.panel);
  const on = panel === 'comments';
  return (
    <button
      className="fc-btn"
      aria-pressed={on}
      style={on ? { background: '#f0f0f0' } : undefined}
      onClick={() => {
        useBoard.getState().set({ panel: on ? null : 'comments' });
        if (!on) useUi.getState().set({ tokensOpen: false, selectedEdge: null });
      }}
    >
      Comments
      {open > 0 && (
        <span className="tnum" aria-label={`${open} open`} style={{ color: 'var(--fc-muted)' }}>
          {open}
        </span>
      )}
    </button>
  );
}
