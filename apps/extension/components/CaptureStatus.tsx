/**
 * "Capturing screenshots 12/31 · Recapture all" (feature 8, UI_REFERENCE
 * status bar). Tabular numerals so the counter never shifts the layout.
 * Inline in the Canvas status pill; `floating` = its own small pill (Player).
 */
import { recaptureAll, useStills } from '@/lib/canvas/capture';

export function CaptureStatus({ floating = false }: { floating?: boolean }) {
  const p = useStills((s) => s.progress);
  const count = useStills((s) => Object.keys(s.stills).length);
  const sep = <span style={{ color: 'var(--fc-faint)' }}>·</span>;
  const text = p.running
    ? `Capturing screenshots ${p.done}/${p.total}`
    : p.paused
      ? 'Screenshots cleared'
      : `Screenshots ${count}${p.failed ? ` · ${p.failed} failed` : ''}`;
  const body = (
    <>
      <span className="tnum" data-fc-capture={p.running ? 'running' : 'idle'}>
        {text}
      </span>
      {sep}
      <button className="fc-btn" style={{ fontSize: 10, paddingInline: 4 }} onClick={recaptureAll}>
        Recapture all
      </button>
    </>
  );
  if (!floating) return body;
  if (!p.running) return null;
  return (
    <div
      role="status"
      className="tnum absolute bottom-3 start-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#e6e6e6] bg-white px-3"
      style={{ fontSize: 10, color: 'var(--fc-muted)', minBlockSize: 26 }}
    >
      {body}
    </div>
  );
}
