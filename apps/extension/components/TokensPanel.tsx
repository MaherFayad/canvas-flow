/**
 * Tokens panel (UI_REFERENCE frame_38): CSS custom properties read from the
 * app's :root, grouped; edits preview live in every frame (streamed once per
 * animation frame by App), "Add to change set" commits them to the config.
 */
import { useMemo, useState } from 'react';
import type { Token } from '@flowcanvas/protocol';
import { groupTokens, shortName, sliderMax, splitLength, type TokenGroup } from '@/lib/canvas/tokenGroups';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { effectiveValues, needsTailwindNote, toCss, toDtcg } from '@/lib/canvas/tokenExport';

function download(name: string, type: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Export (feature 7): W3C design tokens JSON, CSS :root block, copy to clipboard. Uses the values on show (base + changes). */
function ExportRow({ base }: { base: Token[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const values = () => effectiveValues(base, useProject.getState().config.tokens, useUi.getState().tokenDraft);
  const json = () => JSON.stringify(toDtcg(values()), null, 2) + '\n';
  const copy = async (kind: 'CSS' | 'JSON') => {
    const text = kind === 'CSS' ? toCss(values()) : json();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 1500);
  };
  const btn = 'fc-btn';
  return (
    <section className="flex flex-col gap-1 px-3 py-2.5" aria-label="Export tokens">
      <h3 className="fc-label mb-0.5">Export</h3>
      <div className="flex flex-wrap items-center gap-1">
        <button className={btn} style={{ border: '1px solid var(--fc-line)' }} onClick={() => download('tokens.json', 'application/json', json())}>
          JSON ↓
        </button>
        <button className={btn} style={{ border: '1px solid var(--fc-line)' }} onClick={() => download('tokens.css', 'text/css', toCss(values()))}>
          CSS ↓
        </button>
        <button className={btn} onClick={() => void copy('CSS')}>
          Copy CSS
        </button>
        <button className={btn} onClick={() => void copy('JSON')}>
          Copy JSON
        </button>
      </div>
      <div role="status" style={{ fontSize: 10, color: copied === 'failed' ? 'var(--fc-red)' : 'var(--fc-green)', minBlockSize: 12 }}>
        {copied === 'failed' ? 'Clipboard blocked' : copied ? `Copied ${copied}` : ''}
      </div>
    </section>
  );
}

const isHex = (v: string) => /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim());
const fullHex = (v: string) => (v.length === 4 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v);

function setDraft(name: string, value: string | null) {
  const d = { ...useUi.getState().tokenDraft };
  if (value === null) delete d[name];
  else d[name] = value;
  useUi.getState().set({ tokenDraft: d });
}

function TokenRow({ t, group, value, changed, base }: { t: Token; group: TokenGroup; value: string; changed: boolean; base: string }) {
  const len = splitLength(value);
  const id = `tok-${t.name}`;
  const reset = (
    <button
      className="fc-btn"
      aria-label={`Reset ${t.name} to ${base}`}
      title={`Reset to ${base}`}
      style={{ visibility: changed ? 'visible' : 'hidden', paddingInline: 4 }}
      onClick={() => {
        const committed = useProject.getState().config.tokens[t.name];
        setDraft(t.name, committed !== undefined ? base : null);
      }}
    >
      ↺
    </button>
  );
  return (
    <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: '6px 64px 1fr auto' }}>
      <span aria-hidden style={{ inlineSize: 5, blockSize: 5, borderRadius: 3, background: changed ? 'var(--fc-orange)' : 'transparent' }} />
      <label htmlFor={id} className="truncate" title={t.name} style={{ color: 'var(--fc-muted)' }}>
        {shortName(t.name)}
        {changed && <span className="sr-only"> (changed)</span>}
      </label>
      {group === 'Colour' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`${t.name} colour picker`}
            value={isHex(value) ? fullHex(value) : '#000000'}
            disabled={!isHex(value)}
            onChange={(e) => setDraft(t.name, e.target.value.toUpperCase())}
            style={{ inlineSize: 24, blockSize: 24, padding: 0, border: '1px solid var(--fc-line)', borderRadius: 4, background: value }}
          />
          <input id={id} className="fc-input mono w-full" value={value} onChange={(e) => setDraft(t.name, e.target.value)} />
        </div>
      ) : len && group !== 'Font family' && group !== 'Other' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            className="fc-range"
            aria-label={`${t.name} slider`}
            min={0}
            max={sliderMax(splitLength(base)?.n ?? len.n, len.unit, group)}
            step={len.unit === 'px' ? 1 : 0.05}
            value={len.n}
            onChange={(e) => setDraft(t.name, `${e.target.value}${len.unit}`)}
          />
          <input
            id={id}
            className="fc-input tnum"
            style={{ inlineSize: 40 }}
            value={len.n}
            onChange={(e) => e.target.value !== '' && setDraft(t.name, `${e.target.value}${len.unit}`)}
          />
          <span style={{ color: 'var(--fc-muted)', inlineSize: 18 }}>{len.unit}</span>
        </div>
      ) : (
        <input id={id} className="fc-input w-full" value={value} onChange={(e) => setDraft(t.name, e.target.value)} />
      )}
      {reset}
    </div>
  );
}

export function TokensPanel() {
  const base = useUi((s) => s.baseTokens);
  const draft = useUi((s) => s.tokenDraft);
  const overrides = useProject((s) => s.config.tokens);
  const groups = useMemo(() => groupTokens(base ?? []), [base]);
  const draftCount = Object.keys(draft).length;
  const committedCount = Object.keys(overrides).length;

  return (
    <aside aria-label="Tokens" className="fc-panel">
      <section className="flex flex-col gap-1 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold" style={{ fontSize: 11 }}>
            Tokens <span className="tnum" style={{ color: 'var(--fc-muted)', fontWeight: 400 }}>{base?.length ?? 0}</span>
          </h2>
          {draftCount > 0 && (
            <span className="tnum" style={{ fontSize: 10, color: 'var(--fc-orange)', background: '#fff3e6', borderRadius: 4, paddingInline: 5 }}>
              {draftCount} unsaved
            </span>
          )}
          <button className="fc-btn ms-auto" aria-label="Close tokens" onClick={() => useUi.getState().set({ tokensOpen: false })}>
            ✕
          </button>
        </div>
        <div style={{ color: 'var(--fc-muted)', fontSize: 10 }}>
          {base === null ? 'Waiting for a live frame…' : base.length ? 'Found in :root' : 'No CSS custom properties on :root.'}
        </div>
        {needsTailwindNote(base) && (
          <p role="note" className="mt-1 rounded-md px-2 py-1.5" style={{ fontSize: 10, background: '#fff7ed', color: '#9a4b06' }}>
            This app uses compiled Tailwind classes. Token edits need Tailwind v4 or CSS variables.
          </p>
        )}
      </section>
      {groups.map((g) => (
        <section key={g.group} className="flex flex-col gap-1 px-3 py-2.5">
          <h3 className="fc-label mb-0.5">{g.group}</h3>
          {g.tokens.map((t) => {
            const value = draft[t.name] ?? overrides[t.name] ?? t.value;
            return <TokenRow key={t.name} t={t} group={g.group} value={value} base={t.value} changed={value !== t.value} />;
          })}
        </section>
      ))}
      {!!base?.length && <ExportRow base={base} />}
      {!!base?.length && (
        <section className="sticky bottom-0 flex items-center gap-2 bg-white px-3 py-3">
          <button
            className="fc-btn blue flex-1"
            disabled={!draftCount}
            onClick={() => {
              const baseMap = new Map(base.map((t) => [t.name, t.value]));
              useProject.getState().update((c) => {
                const tokens = { ...c.tokens };
                for (const [k, v] of Object.entries(draft)) {
                  if (baseMap.get(k) === v) delete tokens[k];
                  else tokens[k] = v;
                }
                return { ...c, tokens };
              });
              useUi.getState().set({ tokenDraft: {}, announce: `${draftCount} token change${draftCount > 1 ? 's' : ''} added` });
            }}
          >
            Add to change set
          </button>
          {draftCount > 0 || !committedCount ? (
            <button className="fc-btn" disabled={!draftCount} onClick={() => useUi.getState().set({ tokenDraft: {}, announce: 'Token changes discarded' })}>
              Discard all
            </button>
          ) : (
            <button
              className="fc-btn"
              title="Remove every token override from the change set (one undo step) and show the app's own values"
              onClick={() => {
                useProject.getState().update((c) => ({ ...c, tokens: {} }));
                useUi.getState().set({ announce: 'Tokens reset to the app values' });
              }}
            >
              Reset to app
            </button>
          )}
        </section>
      )}
    </aside>
  );
}
