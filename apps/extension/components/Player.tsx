/**
 * Player mode (UI_REFERENCE, the default): a vertically scrolling board of
 * sections; each section is a horizontal row of device frames with the
 * trigger text in the gaps. ←/→ (keys or stepper) move the active step and
 * the board pans to it with a 450 ms Snappy rAF tween (interruptible).
 *
 * "Play" (sub-header, or the ▶ next to a section title) swaps the board for
 * the play stage (PlayerStage): one device, real transitions between screens,
 * starting at the current step. Closing it returns to the board on the step
 * the stage ended on.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { MAX_LIVE, selectLive } from '@/lib/canvas/live';
import { createTween } from '@/lib/canvas/easing';
import { ITEM_GAP, ITEM_HEADER_H, edgeMeta, outgoing, playerLayout, triggerText, type PlayerItem, type PlayerRow } from '@/lib/canvas/player';
import { usePlay } from '@/lib/canvas/playState';
import { CaptureStatus } from './CaptureStatus';
import { DeviceFrame } from './DeviceFrame';
import { StateBadge } from './FrameNode';
import { PlayerStage } from './PlayerStage';

const ZOOMS = [1, 0.5, 0.25];
const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function usePlayerModel() {
  const config = useProject((s) => s.config);
  const deviceId = useUi((s) => s.deviceId);
  const device = deviceById(config.devices, deviceId);
  const layout = useMemo(() => playerLayout(config, device), [config, device]);
  const step = useUi((s) => s.step);
  const row = layout.rows.find((r) => r.id === step?.row) ?? layout.rows[0] ?? null;
  const index = row ? Math.max(0, row.items.findIndex((i) => i.key === step?.key)) : 0;
  const item = row?.items[index] ?? null;
  const override = usePlay((s) => (item ? s.overrides[item.key] : undefined));
  /** State on show for the active step (a sidebar state row or the stage can override the item's default). */
  const state = override ?? item?.state ?? 'default';
  return { config, device, layout, row, index, item, state };
}

export function setStep(row: PlayerRow, i: number) {
  const it = row.items[Math.max(0, Math.min(row.items.length - 1, i))];
  if (!it) return;
  const pc = usePlay.getState();
  if (pc.playing && pc.playing !== row.id) usePlay.setState({ playing: null });
  useUi.getState().set({ step: { row: row.id, key: it.key }, announce: `${row.title}, ${it.screen.title}, ${it.state}, step ${row.items.indexOf(it) + 1} of ${row.items.length}` });
}

function SubHeader({ reload }: { reload: () => void }) {
  const { config, row, index, item, state } = usePlayerModel();
  const zoom = useUi((s) => s.playerZoom);
  const playing = usePlay((s) => s.playing);
  const controls = usePlay((s) => s.controls);
  if (!row || !item) return <div style={{ blockSize: 44, background: '#fff', borderBlockEnd: '1px solid var(--fc-line)' }} />;
  const next = (state === item.state ? item.next : null) ?? outgoing(config, item.screen.id, state)[0] ?? null;
  const zoomTo = (z: number) => useUi.getState().set({ playerZoom: Math.round(Math.min(1.5, Math.max(0.2, z)) * 100) / 100 });
  return (
    <div className="flex items-center gap-3 px-4" style={{ minBlockSize: 44, background: '#fff', borderBlockEnd: '1px solid var(--fc-line)' }}>
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-1.5" style={{ fontSize: 11 }}>
          <span className="font-semibold">{row.title}</span>
          <span style={{ color: 'var(--fc-faint)' }}>·</span>
          <span>{item.screen.title}</span>
          <span style={{ color: 'var(--fc-faint)' }}>·</span>
          <span style={{ color: 'var(--fc-muted)' }}>{state}</span>
          <StateBadge state={state} />
        </div>
        <div className="truncate tnum" style={{ fontSize: 10, color: 'var(--fc-muted)' }}>
          {next ? `Next: ${next.trigger.label || triggerText(next)} (${edgeMeta(next)})` : 'End of flow'}
        </div>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <button
          className="fc-btn primary"
          aria-pressed={!!playing}
          title={playing ? 'Back to the board (Esc)' : 'Play this flow with its transitions'}
          onClick={() => usePlay.setState({ playing: playing ? null : row.id })}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        {!playing && (
        <>
        <div className="flex items-center rounded-md border border-[#e6e6e6]" role="group" aria-label="Zoom">
          <button className="fc-btn" aria-label="Zoom out" onClick={() => zoomTo(zoom - 0.05)}>
            –
          </button>
          <span className="tnum inline-block w-9 text-center" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button className="fc-btn" aria-label="Zoom in" onClick={() => zoomTo(zoom + 0.05)}>
            +
          </button>
        </div>
        <div className="flex items-center gap-0.5" role="group" aria-label="Scale">
          {ZOOMS.map((z) => (
            <button key={z} className="fc-btn" aria-pressed={zoom === z} style={zoom === z ? { background: '#f0f0f0', fontWeight: 600 } : { color: 'var(--fc-muted)' }} onClick={() => zoomTo(z)}>
              {z}×
            </button>
          ))}
        </div>
        <button className="fc-btn" aria-label="Reload this frame" title="Reload this frame" onClick={reload}>
          ↻
        </button>
        </>
        )}
        <div className="flex items-center gap-1" role="group" aria-label="Step">
          <button className="fc-btn" aria-label="Previous step" disabled={!playing && index === 0} onClick={() => (playing && controls ? controls.back() : setStep(row, index - 1))}>
            ←
          </button>
          <span className="tnum inline-block min-w-10 text-center" style={{ fontSize: 11 }}>
            {index + 1} / {row.items.length}
          </span>
          <button
            className="fc-btn"
            aria-label="Next step"
            disabled={!playing && index >= row.items.length - 1}
            onClick={() => (playing && controls ? controls.next() : setStep(row, index + 1))}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

const Item = memo(function Item({
  item,
  active,
  live,
  origin,
  reloadKey,
  onPick,
}: {
  item: PlayerItem;
  active: boolean;
  live: boolean;
  origin: string;
  reloadKey: number;
  onPick: () => void;
}) {
  const config = useProject((s) => s.config);
  const device = deviceById(config.devices, useUi.getState().deviceId);
  const state = usePlay((s) => s.overrides[item.key]) ?? item.state;
  return (
    <div className="fc-frame" style={{ position: 'absolute', insetInlineStart: item.x, insetBlockStart: item.y - ITEM_HEADER_H, inlineSize: item.w }}>
      <div className="flex items-center gap-2" style={{ blockSize: ITEM_HEADER_H, fontSize: 15 }}>
        <span className="truncate" style={{ color: 'var(--fc-ink)' }}>
          {item.screen.title}
        </span>
        {state !== item.screen.states[0] && <span style={{ color: 'var(--fc-faint)' }}>{state}</span>}
        {item.screen.states.length > 1 && <span style={{ color: 'var(--fc-faint)' }}>{item.screen.states.length}</span>}
        <span className="ms-auto">
          <StateBadge state={state} size={13} />
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        {Array.from({ length: item.stack }, (_, k) => (
          <div key={k} aria-hidden className="fc-stack" style={{ transform: `translate(${(item.stack - k) * 9}px, ${(item.stack - k) * 9}px)` }} />
        ))}
        <div
          style={{ position: 'relative', cursor: active ? 'auto' : 'pointer' }}
          onClickCapture={(e) => {
            if (!active) {
              e.stopPropagation();
              onPick();
            }
          }}
        >
          <DeviceFrame screen={item.screen} state={state} device={device} origin={origin} live={live} interactive={active} active={active} reloadKey={reloadKey} />
        </div>
      </div>
      {item.next && (
        <div
          aria-hidden
          className="tnum"
          style={{
            position: 'absolute',
            insetInlineStart: item.w,
            inlineSize: ITEM_GAP,
            insetBlockStart: ITEM_HEADER_H + item.h / 2 - 20,
            textAlign: 'center',
            fontSize: 15,
            lineHeight: 1.35,
            color: 'var(--fc-muted)',
            paddingInline: 8,
          }}
        >
          <div>{triggerText(item.next)}</div>
          <div style={{ fontSize: 18 }}>→</div>
        </div>
      )}
    </div>
  );
});

export function Player() {
  const { layout, row, index, item } = usePlayerModel();
  const playing = usePlay((s) => s.playing);
  const playRow = playing ? layout.rows.find((r) => r.id === playing) : undefined;
  const zoom = useUi((s) => s.playerZoom);
  const origin = useUi((s) => s.origin);
  const live = useUi((s) => s.live);
  const forcedHover = useUi((s) => s.forced);
  const scroller = useRef<HTMLDivElement>(null);
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const lastLive = useRef(new Map<string, number>());

  const tween = useMemo(
    () =>
      createTween(
        () => [scroller.current?.scrollLeft ?? 0, scroller.current?.scrollTop ?? 0],
        ([x, y]) => {
          const el = scroller.current;
          if (!el) return;
          el.scrollLeft = x!;
          el.scrollTop = y!;
        },
      ),
    [],
  );

  /* Centre the active step (animated). */
  const centre = useCallback(
    (animate: boolean) => {
      const el = scroller.current;
      if (!el || !row || !item) return;
      const x = (item.x + item.w / 2) * zoom - el.clientWidth / 2;
      const y = (row.y - 24) * zoom;
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;
      tween.start([Math.max(0, Math.min(maxX, x)), Math.max(0, Math.min(maxY, y))], animate ? undefined : 0);
    },
    [row, item, zoom, tween],
  );
  const first = useRef(true);
  const onStage = !!playing;
  useLayoutEffect(() => {
    // Back from the stage: jump (no tween) to the step it ended on.
    if (onStage) {
      first.current = true;
      return;
    }
    centre(!first.current);
    first.current = false;
  }, [item?.key, row?.id, centre, onStage]);
  useEffect(() => () => tween.cancel(), [tween]);

  /* Live set: active step and its neighbours always; then on-screen frames up to MAX_LIVE (no screenshots until M5). */
  const computeLive = useCallback(() => {
    const el = scroller.current;
    if (!el || !row) return;
    const forced = new Set<string>(forcedHover);
    for (const d of [-1, 0, 1]) {
      const it = row.items[index + d];
      if (it) forced.add(it.key);
    }
    const frames = layout.rows.flatMap((r) => r.items.map((i) => ({ key: i.key, x: i.x, y: i.y, w: i.w, h: i.h })));
    const view = { x: el.scrollLeft / zoom, y: el.scrollTop / zoom, w: el.clientWidth / zoom, h: el.clientHeight / zoom };
    const next = selectLive({ frames, view, zoom, forced, lastLive: lastLive.current, max: MAX_LIVE });
    const now = performance.now();
    for (const k of next) lastLive.current.set(k, now);
    if (!setsEqual(next, useUi.getState().live)) useUi.getState().set({ live: next });
  }, [layout, row, index, zoom, forcedHover]);
  useEffect(() => {
    computeLive();
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeLive);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => (el.removeEventListener('scroll', onScroll), cancelAnimationFrame(raf));
  }, [computeLive]);

  /* ←/→ step; wheel interrupts a running camera move. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing || isTyping(e.target) || !row || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') (e.preventDefault(), setStep(row, index + 1));
      else if (e.key === 'ArrowLeft') (e.preventDefault(), setStep(row, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, index, playing]);

  if (!layout.rows.length) return null;
  if (playRow) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <SubHeader reload={() => undefined} />
        <PlayerStage key={playRow.id} row={playRow} startIndex={playRow.id === row?.id ? index : 0} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <SubHeader reload={() => item && setReloadKeys((r) => ({ ...r, [item.key]: (r[item.key] ?? 0) + 1 }))} />
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{ background: 'var(--fc-board)', overscrollBehavior: 'contain' }}
        onWheel={() => tween.cancel()}
        role="region"
        aria-label="Flow board"
        tabIndex={0}
      >
        <div style={{ inlineSize: layout.w * zoom, blockSize: layout.h * zoom, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, inlineSize: layout.w, blockSize: layout.h, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
            {layout.rows.map((r) => (
              <section key={r.id} aria-label={r.title}>
                <div style={{ position: 'absolute', insetInlineStart: 64, insetBlockStart: r.y, display: 'flex', gap: 12, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                  <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{r.title}</h2>
                  <span style={{ fontSize: 16, color: 'var(--fc-muted)' }}>{r.summary}</span>
                  <button
                    className="fc-btn"
                    style={{ fontSize: 15, color: 'var(--fc-muted)', alignSelf: 'center' }}
                    aria-label={`Play ${r.title}`}
                    onClick={() => {
                      setStep(r, 0);
                      usePlay.setState({ playing: r.id });
                    }}
                  >
                    ▶ Play
                  </button>
                </div>
                {r.items.map((it, i) => (
                  <Item
                    key={it.key}
                    item={it}
                    active={r.id === row?.id && i === index}
                    live={live.has(it.key)}
                    origin={origin}
                    reloadKey={reloadKeys[it.key] ?? 0}
                    onPick={() => setStep(r, i)}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
      <CaptureStatus floating />
    </div>
  );
}

