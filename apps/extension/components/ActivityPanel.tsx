/** Activity panel (feature 11 guardrails): every Claude tool call with time and result. */
import { useClaude } from '@/store/claude';
import { useBoard } from '@/store/board';
import { setPaused } from './ClaudeLink';

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export function ActivityPanel() {
  const rows = useClaude((s) => s.activity);
  const phase = useClaude((s) => s.phase);
  const name = useClaude((s) => s.name);
  const paused = useClaude((s) => s.paused);
  return (
    <aside className="fc-panel" aria-label="Claude activity" style={{ fontSize: 11 }}>
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 600 }}>
            Activity <span className="tnum" style={{ color: 'var(--fc-muted)', fontWeight: 400 }}>{rows.length}</span>
          </h2>
          <p style={{ color: 'var(--fc-muted)' }}>
            {phase === 'linked' ? `Claude is linked${name ? ` to ${name}` : ''}${paused ? ' · paused' : ''}` : 'Claude is not linked'}
          </p>
        </div>
        <button className="fc-btn" aria-label="Close activity" onClick={() => useBoard.getState().set({ panel: null })}>
          ×
        </button>
      </div>
      {phase === 'linked' && (
        <section className="px-3 py-2">
          <button className="fc-btn" role="switch" aria-checked={paused} style={{ paddingInline: 0 }} onClick={() => setPaused(!paused)}>
            <input type="checkbox" readOnly checked={paused} tabIndex={-1} aria-hidden style={{ accentColor: 'var(--fc-black)' }} />
            Pause Claude (blocks every change)
          </button>
        </section>
      )}
      <section className="py-1">
        {!rows.length && <p className="px-3 py-2" style={{ color: 'var(--fc-muted)' }}>No tool calls yet. Ask Claude about this canvas.</p>}
        <ol aria-label="Tool calls, newest first">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="grid gap-x-2 px-3 py-1.5" style={{ gridTemplateColumns: 'auto 1fr', borderBlockEnd: '1px solid var(--fc-line)' }}>
              <span className="tnum" style={{ color: 'var(--fc-muted)' }}>
                {time(r.at)}
              </span>
              <span className="mono truncate" style={{ fontWeight: 600 }}>
                {r.tool}
              </span>
              <span />
              <span style={{ color: r.ok ? 'var(--fc-muted)' : 'var(--fc-red)' }}>
                {r.ok ? 'OK' : 'Failed'}
                {r.summary && r.summary !== 'ok' ? ` · ${r.summary}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
