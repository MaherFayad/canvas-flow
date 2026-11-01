/**
 * Claude link UI: starts the link client for this canvas, the top-bar
 * indicator + "Pause Claude" switch, the first-connect Allow prompt and the
 * Allow / Deny toasts for deletes and big token changes.
 */
import { useEffect, useRef } from 'react';
import { applyPatch, applyRemoteConfig, isApplyingRemote } from '@/lib/canvas/claudeApply';
import { handleRequest } from '@/lib/canvas/claudeRequests';
import { ClaudeLinkClient, chromeAllowStore } from '@/lib/canvas/mcpLink';
import { setStillsHost } from '@/lib/canvas/stillsAdapter';
import type { FrameHost } from '@/lib/canvas/frameHost';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useClaude } from '@/store/claude';
import { useBoard } from '@/store/board';

let client: ClaudeLinkClient | null = null;
/** The running link client (null before the canvas has an origin). */
export function linkClient(): ClaudeLinkClient | null {
  return client;
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

/** Start the link for this origin; wire messages to the stores. */
export function useClaudeLink(host: FrameHost | null, origin: string, loaded: boolean) {
  const synced = useRef(false);
  useEffect(() => setStillsHost(host), [host]);
  useEffect(() => {
    if (!origin || !loaded) return;
    synced.current = false;
    const claude = useClaude.getState();
    const announce = (s: string) => useUi.getState().set({ announce: s });
    const c = new ClaudeLinkClient({
      origin,
      extensionVersion: extensionVersion(),
      allowStore: chromeAllowStore,
      handlers: {
        status(s) {
          const prev = useClaude.getState().phase;
          useClaude.getState().set({ phase: s.phase, port: s.port, name: s.name });
          if (s.phase === 'linked' && prev !== 'linked') announce('Claude linked');
          if (prev === 'linked' && s.phase !== 'linked') {
            synced.current = false;
            announce('Claude link lost. Reconnecting.');
          }
        },
        askAllow: (name) =>
          new Promise<boolean>((resolve) => {
            useClaude.getState().set({ ask: { name, resolve } });
            announce(`Claude wants to connect to ${name}. Allow?`);
          }),
        config(raw) {
          const r = applyRemoteConfig(raw, !synced.current);
          if (!r.ok) useClaude.getState().set({ lastError: `The file has errors: ${r.errors.slice(0, 2).join('; ')}` });
          synced.current = true;
        },
        patch(label, raw) {
          const r = applyPatch(label, raw);
          if (!r.ok) {
            useClaude.getState().set({ lastError: `Claude's change could not be shown: ${r.errors[0]}` });
            return;
          }
          useClaude.getState().markChanged(r.changed ?? []);
          announce(label.startsWith('Claude') ? label : `Claude: ${label}`);
        },
        request: (method, params) => handleRequest(host, method, params),
        activity(a) {
          const list = [a, ...useClaude.getState().activity].slice(0, 200);
          useClaude.getState().set({ activity: list });
        },
        error(message, errors) {
          useClaude.getState().set({ lastError: errors?.length ? `${message} ${errors.slice(0, 2).join('; ')}` : message });
          announce(message);
        },
      },
    });
    c.setPaused(claude.paused);
    client = c;
    c.start();
    // Canvas edits flow back to the file (debounced 500 ms in the client).
    const off = useProject.subscribe((s, p) => {
      // Nothing goes back before the first full sync: the file is the source of truth.
      if (s.config === p.config || isApplyingRemote() || !c.linked || !synced.current) return;
      c.sendConfig(s.config);
      useProject.setState({ saved: s.config });
    });
    const flush = () => c.flushConfig();
    window.addEventListener('pagehide', flush);
    const w = window as unknown as { __fc?: Record<string, unknown> };
    w.__fc = { ...w.__fc, claude: useClaude, board: useBoard, link: c };
    return () => {
      off();
      window.removeEventListener('pagehide', flush);
      c.stop();
      if (client === c) client = null;
    };
  }, [origin, loaded, host]);
}

export function setPaused(paused: boolean) {
  useClaude.getState().set({ paused });
  client?.setPaused(paused);
  useUi.getState().set({ announce: paused ? 'Claude paused: Claude cannot change the canvas' : 'Claude resumed' });
}

/** Top-bar: "Claude linked" indicator (opens Activity) + Pause Claude switch. */
export function ClaudeLinkControls() {
  const phase = useClaude((s) => s.phase);
  const paused = useClaude((s) => s.paused);
  const panel = useBoard((s) => s.panel);
  if (phase === 'off' || phase === 'scanning') return null;
  if (phase === 'denied') {
    return (
      <button className="fc-btn" title="Claude is blocked on this project" onClick={() => void client?.allow(true)}>
        <span aria-hidden style={{ inlineSize: 6, blockSize: 6, borderRadius: 3, background: 'var(--fc-faint)' }} />
        Claude blocked · Allow
      </button>
    );
  }
  const linked = phase === 'linked';
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Claude link">
      <button
        className="fc-btn"
        aria-pressed={panel === 'activity'}
        title="Claude is linked to this canvas. Show the Activity panel."
        style={panel === 'activity' ? { background: '#f0f0f0' } : undefined}
        onClick={() => useBoard.getState().set({ panel: panel === 'activity' ? null : 'activity' })}
      >
        <span aria-hidden style={{ inlineSize: 6, blockSize: 6, borderRadius: 3, background: paused ? 'var(--fc-orange)' : linked ? 'var(--fc-green)' : 'var(--fc-faint)' }} />
        {linked ? (paused ? 'Claude paused' : 'Claude linked') : 'Claude waiting'}
      </button>
      {linked && (
        <button
          className="fc-btn"
          role="switch"
          aria-checked={paused}
          title="Pause Claude blocks every change Claude tries to make"
          onClick={() => setPaused(!paused)}
        >
          <span
            aria-hidden
            style={{
              inlineSize: 22,
              blockSize: 12,
              borderRadius: 6,
              background: paused ? 'var(--fc-black)' : '#d4d4d4',
              position: 'relative',
              transition: 'background 120ms',
            }}
          >
            <span
              style={{
                position: 'absolute',
                insetBlockStart: 2,
                insetInlineStart: paused ? 12 : 2,
                inlineSize: 8,
                blockSize: 8,
                borderRadius: 4,
                background: '#fff',
                transition: 'inset-inline-start 120ms var(--fc-snappy)',
              }}
            />
          </span>
          Pause Claude
        </button>
      )}
    </div>
  );
}

/** First-connect prompt + Allow / Deny toasts + link errors. */
export function ClaudeOverlays() {
  const ask = useClaude((s) => s.ask);
  const confirms = useClaude((s) => s.confirms);
  const lastError = useClaude((s) => s.lastError);
  const allowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) allowRef.current?.focus();
  }, [ask]);
  const answer = (granted: boolean) => {
    const a = useClaude.getState().ask;
    useClaude.getState().set({ ask: null });
    a?.resolve(granted);
  };
  const decide = (id: string, allowed: boolean) => {
    const c = useClaude.getState().confirms.find((x) => x.id === id);
    useClaude.getState().set({ confirms: useClaude.getState().confirms.filter((x) => x.id !== id) });
    c?.resolve(allowed);
    useUi.getState().set({ announce: allowed ? 'Allowed' : 'Denied' });
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 top-11 z-[60] flex flex-col items-center gap-2" style={{ fontSize: 11 }}>
      {ask && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="fc-claude-ask"
          className="fc-toast pointer-events-auto"
          onKeyDown={(e) => e.key === 'Escape' && answer(false)}
        >
          <span id="fc-claude-ask">
            <strong>Claude</strong> wants to connect to <strong>{ask.name}</strong>. Allow?
          </span>
          <span className="flex gap-1">
            <button className="fc-btn" onClick={() => answer(false)}>
              Deny
            </button>
            <button ref={allowRef} className="fc-btn primary" onClick={() => answer(true)}>
              Allow
            </button>
          </span>
        </div>
      )}
      {confirms.map((c) => (
        <div key={c.id} role="alertdialog" aria-label="Claude asks to confirm" className="fc-toast pointer-events-auto">
          <span>
            <span className="fc-badge" style={{ background: 'var(--fc-black)', color: '#fff', marginInlineEnd: 6 }}>
              Claude
            </span>
            {c.message}
          </span>
          <span className="flex gap-1">
            <button className="fc-btn" onClick={() => decide(c.id, false)}>
              Deny
            </button>
            <button className="fc-btn primary" onClick={() => decide(c.id, true)}>
              Allow
            </button>
          </span>
        </div>
      ))}
      {lastError && (
        <div role="alert" className="fc-toast pointer-events-auto" style={{ borderColor: '#f2b8b8' }}>
          <span style={{ color: 'var(--fc-red)' }}>{lastError}</span>
          <button className="fc-btn" aria-label="Dismiss" onClick={() => useClaude.getState().set({ lastError: null })}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
