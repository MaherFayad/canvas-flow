/**
 * Play stage (feature 6, UI_REFERENCE rule 9): one device in the middle,
 * screens swap with the edge's transition. Used two ways:
 * - PlayerStage: Player mode's "Play" — walks a section's flow; hint arrows for
 *   the current screen's outgoing edges; tap the real target in the frame, or
 *   press →/Enter (or 1–9) to play an edge; Esc/← goes back with the reverse
 *   transition; Restart.
 * - EdgePlayPopover: the edge inspector's "Play edge": plays that one edge
 *   with the current settings, Replay / Loop.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Device, Edge, FlowCanvasConfig } from '@flowcanvas/config';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { Stage, type StageNode } from '@/lib/canvas/stage';
import { clickMatches, primaryEdge } from '@/lib/canvas/transitions';
import { chromeInsets } from '@/lib/canvas/geometry';
import { edgeMeta, outgoing, triggerText, type PlayerRow } from '@/lib/canvas/player';
import { setOverride, usePlay } from '@/lib/canvas/playState';
import { useHost } from './host';
import { DeviceShell } from './DeviceFrame';
import { StateBadge } from './FrameNode';

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

const nodeOf = (c: FlowCanvasConfig, screen: string, state: string): StageNode | null => {
  const s = c.screens.find((x) => x.id === screen);
  return s ? { screen: s, state } : null;
};

function outerSize(d: Device) {
  const i = chromeInsets(d);
  return { w: d.w + 2 * i.side, h: i.top + d.h + i.bottom + 2 * i.side };
}

/** Scale that fits the device in a box. */
function useFit(box: React.RefObject<HTMLElement | null>, d: Device, reserveW: number, pad = 32, max = 1) {
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const o = outerSize(d);
    const fit = () => setScale(Math.max(0.15, Math.min(max, (el.clientHeight - pad * 2) / o.h, (el.clientWidth - reserveW - pad * 2) / o.w)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, d, reserveW, pad, max]);
  return scale;
}

/** One Stage engine bound to a screen slot element. */
function useStage(
  slot: React.RefObject<HTMLDivElement | null>,
  device: Device,
  handlers: { interceptFor: (n: StageNode) => string[]; onTap?: (t: string) => void; onReady?: (n: StageNode) => void },
) {
  const host = useHost();
  const origin = useUi((s) => s.origin);
  const h = useRef(handlers);
  h.current = handlers;
  const [stage, setStage] = useState<Stage | null>(null);
  useEffect(() => {
    const el = slot.current;
    if (!el || !host) return;
    const st = new Stage(el, {
      host,
      origin,
      device,
      interceptFor: (n) => h.current.interceptFor(n),
      onTap: (t) => h.current.onTap?.(t),
      onReady: (n) => h.current.onReady?.(n),
    });
    setStage(st);
    return () => st.destroy();
  }, [slot, host, origin, device]);
  return stage;
}

const targetsOf = (c: FlowCanvasConfig, n: StageNode) =>
  outgoing(c, n.screen.id, n.state)
    .map((e) => e.trigger.target?.trim())
    .filter((t): t is string => !!t);

/* ------------------------------------------------------------------ */
/* Player stage                                                         */
/* ------------------------------------------------------------------ */

export function PlayerStage({ row, startIndex }: { row: PlayerRow; startIndex: number }) {
  const config = useProject((s) => s.config);
  const deviceId = useUi((s) => s.deviceId);
  const device = deviceById(config.devices, deviceId);
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const scale = useFit(box, device, 300, 28);
  const cfg = useRef(config);
  cfg.current = config;

  const start = useMemo<StageNode | null>(() => {
    const it = row.items[startIndex] ?? row.items[0];
    if (!it) return null;
    return { screen: it.screen, state: usePlay.getState().overrides[it.key] ?? it.state };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  const [node, setNode] = useState<StageNode | null>(start);
  const [history, setHistory] = useState<Array<{ node: StageNode; edge: Edge }>>([]);
  const [busy, setBusy] = useState(false);
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const histRef = useRef(history);
  histRef.current = history;
  const autoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const edges = useMemo(() => (node ? outgoing(config, node.screen.id, node.state) : []), [config, node]);
  /** → plays the edge to the row's next step when there is one. */
  const primary = useMemo(() => {
    if (!node) return null;
    const i = row.items.findIndex((it) => it.screen.id === node.screen.id);
    const nextIt = i >= 0 ? row.items[i + 1] : undefined;
    return primaryEdge(edges, nextIt ? { screen: nextIt.screen.id } : null);
  }, [edges, node, row]);

  /** Keep the board's step (and sub-header) in sync with the stage. */
  const syncStep = useCallback(
    (n: StageNode) => {
      const i = row.items.findIndex((it) => it.screen.id === n.screen.id);
      if (i < 0) return;
      const it = row.items[i]!;
      setOverride(it.key, n.state === it.state ? null : n.state);
      useUi.getState().set({ step: { row: row.id, key: it.key }, announce: `${n.screen.title}, ${n.state}` });
    },
    [row],
  );

  const stage = useStage(slot, device, {
    interceptFor: (n) => targetsOf(cfg.current, n),
    onTap: (target) => {
      const n = nodeRef.current;
      if (!n) return;
      const e = outgoing(cfg.current, n.screen.id, n.state).find((x) => clickMatches(x, target));
      if (e) void play(e);
    },
    onReady: (n) => {
      // auto-after-ms edges fire on their own once the screen is up.
      clearTimeout(autoTimer.current);
      const auto = outgoing(cfg.current, n.screen.id, n.state).find((e) => e.trigger.gesture === 'auto-after-ms');
      if (auto) autoTimer.current = setTimeout(() => nodeRef.current === n && void play(auto), auto.trigger.afterMs ?? 1000);
    },
  });

  useEffect(() => {
    if (stage && start) void stage.show(start);
  }, [stage, start]);
  useEffect(() => () => clearTimeout(autoTimer.current), []);
  useEffect(() => stage?.refreshIntercepts(), [stage, config.edges]);

  const play = useCallback(
    async (e: Edge) => {
      const from = nodeRef.current;
      const to = nodeOf(cfg.current, e.to.screen, e.to.state);
      if (!stage || !from || !to) return;
      clearTimeout(autoTimer.current);
      nodeRef.current = to;
      setBusy(true);
      setNode(to);
      setHistory((h) => [...h, { node: from, edge: e }]);
      syncStep(to);
      await stage.go(to, e);
      usePlay.setState((s) => ({ transitions: s.transitions + 1 }));
      setBusy(false);
    },
    [stage, syncStep],
  );
  const back = useCallback(async () => {
    const h = histRef.current;
    const last = h[h.length - 1];
    if (!stage || !last) return;
    clearTimeout(autoTimer.current);
    nodeRef.current = last.node;
    setBusy(true);
    setNode(last.node);
    setHistory(h.slice(0, -1));
    syncStep(last.node);
    await stage.go(last.node, last.edge, true);
    usePlay.setState((s) => ({ transitions: s.transitions + 1 }));
    setBusy(false);
  }, [stage, syncStep]);
  const restart = useCallback(async () => {
    const first = row.items[0];
    if (!stage || !first) return;
    clearTimeout(autoTimer.current);
    const n = { screen: first.screen, state: first.state };
    nodeRef.current = n;
    setNode(n);
    setHistory([]);
    syncStep(n);
    await stage.go(n, { transition: { type: 'fade', duration: 200, easing: 'ease-out' } });
  }, [stage, row, syncStep]);

  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEffect(() => {
    usePlay.setState({ controls: { next: () => primaryRef.current && void play(primaryRef.current), back: () => void back(), restart: () => void restart() } });
    return () => usePlay.setState({ controls: null });
  }, [play, back, restart]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (isTyping(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'ArrowRight' || ev.key === 'Enter') {
        ev.preventDefault();
        if (primaryRef.current) void play(primaryRef.current);
      } else if (ev.key === 'ArrowLeft' || ev.key === 'Escape' || ev.key === 'Backspace') {
        ev.preventDefault();
        if (histRef.current.length) void back();
        else if (ev.key === 'Escape') usePlay.setState({ playing: null });
      } else if (/^[1-9]$/.test(ev.key)) {
        const n = nodeRef.current;
        const e = n ? outgoing(cfg.current, n.screen.id, n.state)[Number(ev.key) - 1] : undefined;
        if (e) (ev.preventDefault(), void play(e));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, back]);

  const o = outerSize(device);
  const trail = [...history.map((h) => h.node), ...(node ? [node] : [])];
  return (
    <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center gap-8" style={{ background: 'var(--fc-board)' }} data-fc-stage="player">
      <div style={{ inlineSize: o.w * scale, blockSize: o.h * scale, flex: 'none', position: 'relative' }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', insetInlineStart: 0, insetBlockStart: 0 }}>
          <DeviceShell device={device} active screenRef={slot} />
        </div>
      </div>
      <aside aria-label="Play controls" className="flex w-[260px] shrink-0 flex-col gap-3 self-center" style={{ fontSize: 11 }}>
        {node && (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold" style={{ fontSize: 13 }}>
              {node.screen.title}
            </span>
            <span style={{ color: 'var(--fc-muted)' }}>{node.state}</span>
            <StateBadge state={node.state} />
          </div>
        )}
        <div className="flex flex-col gap-1.5" role="group" aria-label="Next screens">
          {edges.length === 0 && <p style={{ color: 'var(--fc-muted)' }}>End of flow. Restart, or go back with Esc.</p>}
          {edges.map((e, i) => (
            <button key={e.id} type="button" className={`fc-hint ${e === primary ? 'primary' : ''}`} onClick={() => void play(e)} aria-keyshortcuts={e === primary ? 'ArrowRight' : String(i + 1)}>
              <span aria-hidden style={{ fontSize: 14, lineHeight: '16px', color: e.kind === 'error' ? 'var(--fc-red)' : 'var(--fc-ink)' }}>
                →
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{triggerText(e)}</span>
                {e.trigger.hint && <span className="block" style={{ color: 'var(--fc-muted)' }}>{e.trigger.hint}</span>}
                <span className="tnum block" style={{ color: 'var(--fc-faint)', fontSize: 10 }}>
                  {edgeMeta(e)}
                  {e.kind !== 'happy' ? ` · ${e.kind}` : ''}
                </span>
              </span>
              <span className="fc-kbd tnum" aria-hidden>
                {e === primary ? '→' : i + 1}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className="fc-btn" disabled={!history.length || busy} onClick={() => void back()} aria-keyshortcuts="Escape">
            ← Back <span className="fc-kbd">Esc</span>
          </button>
          <button className="fc-btn" onClick={() => void restart()}>
            ↺ Restart
          </button>
          <button className="fc-btn ms-auto" onClick={() => usePlay.setState({ playing: null })}>
            Board
          </button>
        </div>
        <ol className="flex flex-wrap items-center gap-1" aria-label="Path" style={{ color: 'var(--fc-muted)', fontSize: 10 }}>
          {trail.map((n, i) => (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span style={i === trail.length - 1 ? { color: 'var(--fc-ink)', fontWeight: 600 } : undefined}>
                {n.screen.title}
                {n.state !== n.screen.states[0] ? ` · ${n.state}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Play edge popover                                                    */
/* ------------------------------------------------------------------ */

export function EdgePlayPopover({ edge, onClose }: { edge: Edge; onClose: () => void }) {
  const config = useProject((s) => s.config);
  const deviceId = useUi((s) => s.deviceId);
  const device = deviceById(config.devices, deviceId);
  const slot = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'playing' | 'done'>('loading');
  const edgeRef = useRef(edge);
  edgeRef.current = edge;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const from = useMemo(() => nodeOf(config, edge.from.screen, edge.from.state), [config, edge.from.screen, edge.from.state]);
  const to = useMemo(() => nodeOf(config, edge.to.screen, edge.to.state), [config, edge.to.screen, edge.to.state]);
  const stage = useStage(slot, device, { interceptFor: () => [] });
  const o = outerSize(device);
  const scale = Math.min(0.42, 420 / o.h);
  const run = useRef(0);

  const playOnce = useCallback(async () => {
    if (!stage || !from || !to) return;
    const my = ++run.current;
    setPhase('loading');
    await stage.resetTo(from);
    await stage.preload(to);
    if (my !== run.current) return;
    await new Promise((r) => setTimeout(r, 350));
    if (my !== run.current) return;
    setPhase('playing');
    await stage.go(to, edgeRef.current);
    if (my !== run.current) return;
    setPhase('done');
    usePlay.setState((s) => ({ transitions: s.transitions + 1 }));
    if (loopRef.current) {
      await new Promise((r) => setTimeout(r, 700));
      if (my === run.current && loopRef.current) void playOnce();
    }
  }, [stage, from, to]);

  useEffect(() => {
    void playOnce();
    return () => void run.current++;
  }, [playOnce]);
  useEffect(() => {
    if (loop && phase === 'done') void playOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div role="dialog" aria-label={`Play edge ${edge.trigger.label || edge.id}`} className="fc-popover flex flex-col gap-2 p-3" style={{ insetInlineEnd: 276, insetBlockStart: 12 }} data-fc-stage="edge">
      <div className="flex items-center gap-2" style={{ fontSize: 11 }}>
        <span className="font-semibold">{triggerText(edge)}</span>
        <span className="tnum" style={{ color: 'var(--fc-muted)' }}>
          {edge.transition.type} · {edge.transition.duration}ms
        </span>
        <button className="fc-btn ms-auto" aria-label="Close play edge" onClick={onClose}>
          ✕
        </button>
      </div>
      <div style={{ inlineSize: o.w * scale, blockSize: o.h * scale, position: 'relative', alignSelf: 'center' }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', insetInlineStart: 0, insetBlockStart: 0 }}>
          <DeviceShell device={device} screenRef={slot} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button className="fc-btn primary" onClick={() => void playOnce()} disabled={!stage}>
          ▶ Replay
        </button>
        <button className="fc-btn" aria-pressed={loop} onClick={() => setLoop((l) => !l)} style={loop ? { background: '#f0f0f0', fontWeight: 600 } : undefined}>
          ⟳ Loop
        </button>
        <span role="status" className="ms-auto" style={{ fontSize: 10, color: 'var(--fc-muted)' }}>
          {phase === 'loading' ? 'Loading…' : phase === 'playing' ? 'Playing' : ''}
        </span>
      </div>
    </div>
  );
}
