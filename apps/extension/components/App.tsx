import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { emptyConfig, frameKey, parseConfig, type FlowCanvasConfig } from '@flowcanvas/config';
import { FrameHost } from '@/lib/canvas/frameHost';
import { screenForPath } from '@/lib/canvas/record';
import { loadProject, saveProject } from '@/lib/canvas/storage';
import { isLocalOrigin, normPath } from '@/lib/url';
import { redo, undo, useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { Canvas } from './Canvas';
import { Discovery } from './Discovery';
import { HostContext } from './host';
import { ImportDialog } from './ImportDialog';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** A click must be followed by a nav within this window to count as one recorded step. */
const RECORD_WINDOW_MS = 5000;

function readOrigin(): string {
  const o = new URLSearchParams(location.search).get('origin') ?? '';
  return isLocalOrigin(o) ? new URL(o).origin : '';
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function App() {
  const origin = useMemo(readOrigin, []);
  const [loaded, setLoaded] = useState(false);
  const [discoverRun, setDiscoverRun] = useState(0);
  const importOpen = useUi((s) => s.importOpen);
  const mode = useUi((s) => s.mode);
  const announce = useUi((s) => s.announce);

  /* FrameHost: one per canvas page, bound to the project origin. */
  const host = useMemo(() => {
    if (!origin) return null;
    return new FrameHost(window, origin, {
      mocksFor: (screen, state) => useProject.getState().config.mocks[frameKey(screen, state)] ?? [],
      tokens: () => useProject.getState().config.tokens,
      recording: () => useUi.getState().recording,
      device: () => {
        const d = deviceById(useProject.getState().config.devices, useUi.getState().deviceId);
        return { w: d.w, h: d.h };
      },
    });
  }, [origin]);
  useEffect(() => () => host?.destroy(), [host]);

  /* Load working copy for this origin. */
  useEffect(() => {
    useUi.getState().set({ origin });
    if (!origin) {
      setLoaded(true);
      return;
    }
    void loadProject(origin).then((p) => {
      if (p) {
        useProject.getState().load(p.config, p.saved);
        if (p.deviceId) useUi.getState().set({ deviceId: p.deviceId });
      } else {
        useProject.getState().load(emptyConfig(origin));
      }
      setLoaded(true);
      if (!useProject.getState().config.screens.length) setDiscoverRun(1);
    });
  }, [origin]);

  /* Persist (debounced) after load. */
  useEffect(() => {
    if (!loaded || !origin) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const { config, saved } = useProject.getState();
        void saveProject(origin, { config, saved, deviceId: useUi.getState().deviceId });
      }, 300);
    };
    const a = useProject.subscribe(persist);
    const b = useUi.subscribe((s, prev) => s.deviceId !== prev.deviceId && persist());
    return () => (a(), b(), clearTimeout(t));
  }, [loaded, origin]);

  /* Route frame messages: status, tokens, record mode. */
  useEffect(() => {
    if (!host) return;
    return host.subscribe((f, msg) => {
      if (f.discover) return;
      const key = frameKey(f.screen, f.state);
      const ui = useUi.getState();
      switch (msg.fc) {
        case 'hello':
          ui.setStatus(key, 'connected');
          break;
        case 'ready':
          ui.setStatus(key, 'ready');
          if (!ui.baseTokens) {
            ui.set({ baseTokens: [] });
            host.send(f.frameId, { fc: 'tokens-request' });
          }
          break;
        case 'tokens-read':
          ui.set({ baseTokens: msg.tokens });
          break;
        case 'screens':
          ui.set({ sdk: { ...ui.sdk, [key]: true } });
          break;
        case 'hmr':
          ui.set({ announce: `${f.screen} hot-reloaded` });
          break;
        case 'nav': {
          const click = f.lastClick;
          if (!ui.recording || !click || Date.now() - click.at > RECORD_WINDOW_MS) break;
          f.lastClick = undefined;
          const cfg = useProject.getState().config;
          const onHome = normPath(msg.from) === normPath(f.path);
          const fromScreen = onHome ? cfg.screens.find((s) => s.id === f.screen) : screenForPath(cfg, msg.from);
          if (!fromScreen) break;
          const fromState = onHome ? f.state : (fromScreen.states[0] ?? 'default');
          const edge = useProject.getState().record({
            from: { screen: fromScreen.id, state: fromState },
            toPath: msg.to,
            click: { target: click.target, text: click.text },
          });
          if (edge) ui.set({ announce: `Recorded edge "${edge.trigger.label || edge.trigger.target}" to ${edge.to.screen}` });
          break;
        }
        default:
          break;
      }
    });
  }, [host]);

  /* Record toggle reaches every connected frame. */
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.recording !== prev.recording) host?.broadcast({ fc: 'record', on: s.recording });
      }),
    [host],
  );
  /* Token overrides reach every frame. */
  useEffect(
    () =>
      useProject.subscribe((s, prev) => {
        if (s.config.tokens !== prev.config.tokens) host?.broadcast({ fc: 'tokens', vars: s.config.tokens });
      }),
    [host],
  );

  /* Keyboard: R record, Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey && e.key.toLowerCase() === 'r') {
        const on = !useUi.getState().recording;
        useUi.getState().set({ recording: on, announce: on ? 'Recording on' : 'Recording off' });
      } else if (e.key === 'Escape') {
        useUi.getState().set({ selectedEdge: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Debug / e2e handle. */
  useEffect(() => {
    (window as unknown as { __fc: unknown }).__fc = { host, project: useProject, ui: useUi };
  }, [host]);

  const onImport = (c: FlowCanvasConfig) => {
    useUi.getState().set({ importOpen: false });
    if (origin && c.project.origin !== origin) {
      // Bound to another app: store it under its origin and switch.
      void saveProject(c.project.origin, { config: c, saved: c }).then(() => {
        const u = new URL(location.href);
        u.searchParams.set('origin', c.project.origin);
        location.href = u.toString();
      });
      return;
    }
    useProject.getState().importConfig(c);
    useUi.getState().set({ announce: `Imported ${c.screens.length} screens and ${c.edges.length} edges` });
  };

  return (
    <HostContext.Provider value={host}>
      <ReactFlowProvider>
        <div
          className="flex h-full flex-col"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const f = e.dataTransfer.files[0];
            if (!f || !/json/.test(f.type || f.name)) return;
            e.preventDefault();
            void f.text().then((t) => {
              try {
                const r = parseConfig(JSON.parse(t));
                if (r.ok) onImport(r.config);
                else useUi.getState().set({ importOpen: true, announce: 'Dropped config has errors; open Import to see them.' });
              } catch {
                useUi.getState().set({ announce: 'Dropped file is not valid JSON' });
              }
            });
          }}
        >
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main role="application" aria-label="Flow canvas" aria-describedby="fc-help" className="relative min-w-0 flex-1">
              <p id="fc-help" className="sr-only">
                Tab moves between frames. Drag from a frame's right handle to another frame to draw an edge. Press R to record flows.
              </p>
              {mode === 'player' ? (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow">
                    <h2 className="mb-1 text-lg font-semibold">Player is coming in M4</h2>
                    <p className="text-[14px] text-gray-600">Step through flows with transitions on a device frame.</p>
                  </div>
                </div>
              ) : (
                loaded && <Canvas />
              )}
              <DiscoveryPill />
            </main>
          </div>
          <div aria-live="polite" role="status" className="sr-only">
            {announce}
          </div>
          {importOpen && <ImportDialog onImport={onImport} onClose={() => useUi.getState().set({ importOpen: false })} />}
          {host && <Discovery run={discoverRun} />}
        </div>
      </ReactFlowProvider>
    </HostContext.Provider>
  );
}

function DiscoveryPill() {
  const d = useUi((s) => s.discovery);
  if (!d?.running) return null;
  return (
    <div className="absolute start-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-1.5 text-[13px] text-white shadow">
      Discovering screens {d.done}/{Math.max(d.total, d.done)}
    </div>
  );
}
