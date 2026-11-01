/**
 * "Discover with Claude": ask Claude Code (through the MCP server) to read the
 * app's source and fill the canvas with its screens, routes and states.
 *
 * - Linked: sends a `discover-request` over the link. The server queues it and
 *   tells subscribed clients; Claude acts the next time the user messages it
 *   (an MCP server cannot wake Claude), so the toast says what to type.
 * - Not linked: copies the `claude mcp add` setup command plus a ready prompt.
 * - When Claude calls complete_request, the toast shows its summary.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { onRequestDone } from '@/lib/canvas/mcpLink';
import { useClaude } from '@/store/claude';
import { useUi } from '@/store/ui';
import { linkClient } from './ClaudeLink';

export const SAY = 'discover my screens';
const DEFAULT_ORIGIN = 'http://localhost:5173';

type Toast =
  | { kind: 'asked'; requestId: string }
  | { kind: 'setup'; text: string; copied: boolean }
  | { kind: 'info'; text: string }
  | { kind: 'done'; summary?: string }
  | null;

const useDiscoverToast = create<{ toast: Toast; set(t: Toast): void }>()((set) => ({ toast: null, set: (toast) => set({ toast }) }));

/** Setup command + prompt for a canvas that is not linked to Claude yet. */
export function setupText(origin: string): string {
  const o = origin && origin !== DEFAULT_ORIGIN ? ` --origin ${origin}` : '';
  return [
    '# 1. In your app folder, add the Flow Canvas MCP server to Claude Code:',
    `claude mcp add flowcanvas -- npx -y @flowcanvas/mcp --project .${o}`,
    '# 2. Start Claude Code there (`claude`), keep this canvas open and click Allow when it asks to connect.',
    '# 3. Then tell Claude:',
    `Discover my screens for Flow Canvas: run the discover_screens prompt from the flowcanvas MCP server (or read flowcanvas://recipes/discover) and fill the canvas for ${origin || DEFAULT_ORIGIN}.`,
  ].join('\n');
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const announce = (s: string) => useUi.getState().set({ announce: s });

/** The action behind the menu item and the empty-state button. */
export async function discoverWithClaude(): Promise<void> {
  const t = useDiscoverToast.getState();
  const phase = useClaude.getState().phase;
  const client = linkClient();
  if (phase === 'linked' && client?.linked) {
    try {
      const r = await client.requestDiscover();
      t.set({ kind: 'asked', requestId: r.requestId });
      announce(`Asked Claude to discover screens. In Claude Code, say: ${SAY}`);
    } catch (e) {
      t.set({ kind: 'info', text: `Could not ask Claude: ${(e as Error).message}` });
    }
    return;
  }
  if (phase === 'prompt') {
    t.set({ kind: 'info', text: 'Claude is waiting for you: click Allow on the prompt at the top first, then try again.' });
    return;
  }
  if (phase === 'denied') {
    t.set({ kind: 'info', text: 'Claude is blocked on this project. Click "Claude blocked · Allow" in the top bar, then try again.' });
    return;
  }
  const text = setupText(useUi.getState().origin);
  const copied = await copy(text);
  t.set({ kind: 'setup', text, copied });
  announce(copied ? 'Copied the Claude setup command and prompt' : 'Claude is not linked. Setup steps shown.');
}

/** Button for empty states. */
export function DiscoverWithClaudeButton({ className = 'fc-btn mt-3' }: { className?: string }) {
  return (
    <button className={className} onClick={() => void discoverWithClaude()} title="Claude reads your app's code and adds its screens, routes and states">
      Discover with Claude
    </button>
  );
}

/** Toast area (mounted once in App). */
export function DiscoverClaudeToast() {
  const toast = useDiscoverToast((s) => s.toast);
  const set = useDiscoverToast((s) => s.set);
  useEffect(
    () =>
      onRequestDone((r) => {
        if (r.kind !== 'discover') return;
        set({ kind: 'done', summary: r.summary });
        announce(`Claude finished discovering screens${r.summary ? `: ${r.summary}` : ''}`);
      }),
    [set],
  );
  useEffect(() => {
    if (toast?.kind !== 'done') return;
    const t = setTimeout(() => set(null), 10_000);
    return () => clearTimeout(t);
  }, [toast, set]);
  if (!toast) return null;
  const close = (
    <button className="fc-btn" aria-label="Dismiss" onClick={() => set(null)}>
      ×
    </button>
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[60] flex justify-center" style={{ fontSize: 11 }}>
      <div role="status" aria-label="Discover with Claude" className="fc-toast pointer-events-auto" style={{ alignItems: 'flex-start' }}>
        {toast.kind === 'asked' && (
          <>
            <span style={{ lineHeight: 1.5 }}>
              Asked Claude to discover screens. In Claude Code, say: <strong>{SAY}</strong>
              <br />
              <span style={{ color: 'var(--fc-muted)' }}>Claude starts when you next message it; the screens appear here as one undo step.</span>
            </span>
            <span className="flex gap-1">
              <button
                className="fc-btn primary"
                onClick={() => void copy(SAY).then((ok) => announce(ok ? `Copied "${SAY}"` : 'Could not copy'))}
              >
                Copy
              </button>
              {close}
            </span>
          </>
        )}
        {toast.kind === 'setup' && (
          <>
            <span style={{ lineHeight: 1.5, minInlineSize: 0 }}>
              <strong>Claude is not linked.</strong> {toast.copied ? 'Copied the setup command and a ready prompt.' : 'Copy the setup command and prompt below.'} Run the command in your app folder,
              start Claude Code, click Allow here, then paste the prompt. Claude reads your routes and components and fills the canvas.
              <pre className="mono mt-1 whitespace-pre-wrap rounded bg-[#f6f6f6] p-2" style={{ fontSize: 10, userSelect: 'all', maxBlockSize: 140, overflow: 'auto' }}>
                {toast.text}
              </pre>
            </span>
            <span className="flex gap-1">
              <button className="fc-btn primary" onClick={() => void copy(toast.text).then((ok) => set({ ...toast, copied: ok }))}>
                Copy
              </button>
              {close}
            </span>
          </>
        )}
        {toast.kind === 'info' && (
          <>
            <span>{toast.text}</span>
            {close}
          </>
        )}
        {toast.kind === 'done' && (
          <>
            <span>
              <span className="fc-badge" style={{ background: 'var(--fc-black)', color: '#fff', marginInlineEnd: 6 }}>
                Claude
              </span>
              Finished discovering screens{toast.summary ? `: ${toast.summary}` : '.'}
            </span>
            {close}
          </>
        )}
      </div>
    </div>
  );
}
