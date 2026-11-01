/** 2-handle cubic-bezier editor with a looping preview dot (UI_REFERENCE edge inspector). */
import { useEffect, useRef, useState } from 'react';
import { formatBezier, parseEasing, prefersReducedMotion, type Bezier } from '@/lib/canvas/easing';

const S = 168; // graph size (px)
const PAD = 14;
const Y_MIN = -0.4;
const Y_MAX = 1.65;
const toX = (x: number) => PAD + x * (S - 2 * PAD);
const toY = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * (S - 2 * PAD);
const fromPx = (px: number, py: number): [number, number] => [
  Math.min(1, Math.max(0, (px - PAD) / (S - 2 * PAD))),
  Math.min(2, Math.max(-1, Y_MAX - ((py - PAD) / (S - 2 * PAD)) * (Y_MAX - Y_MIN))),
];

export function BezierEditor({ easing, duration, onChange }: { easing: string; duration: number; onChange: (css: string) => void }) {
  const parsed = parseEasing(easing);
  const [b, setB] = useState<Bezier>(parsed ?? [0.2, 0.8, 0.2, 1]);
  const [text, setText] = useState(parsed ? formatBezier(parsed) : easing);
  const svg = useRef<SVGSVGElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const drag = useRef<0 | 1 | null>(null);

  useEffect(() => {
    const p = parseEasing(easing);
    if (p) setB(p);
    setText(p ? formatBezier(p) : easing);
  }, [easing]);

  /* Preview dot loops along the track with the current curve and duration. */
  useEffect(() => {
    const el = dot.current;
    if (!el || prefersReducedMotion()) return;
    const anim = el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(206px)' }], {
      duration: Math.max(120, duration),
      easing: formatBezier(b),
      iterations: Infinity,
      endDelay: 500,
      fill: 'both',
    });
    return () => anim.cancel();
  }, [b, duration]);

  const onMove = (e: React.PointerEvent) => {
    if (drag.current === null || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const [x, y] = fromPx(((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S);
    setB((cur) => {
      const n: Bezier = [...cur];
      if (drag.current === 0) (n[0] = x), (n[1] = y);
      else (n[2] = x), (n[3] = y);
      return n;
    });
  };
  const end = () => {
    if (drag.current === null) return;
    drag.current = null;
    onChange(formatBezier(b));
  };
  const nudge = (h: 0 | 1, dx: number, dy: number) => {
    const n: Bezier = [...b];
    const i = h * 2;
    n[i] = Math.min(1, Math.max(0, n[i]! + dx));
    n[i + 1] = n[i + 1]! + dy;
    setB(n);
    onChange(formatBezier(n));
  };

  const curve = `M${toX(0)},${toY(0)} C${toX(b[0])},${toY(b[1])} ${toX(b[2])},${toY(b[3])} ${toX(1)},${toY(1)}`;
  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${S} ${S}`}
        width={S}
        height={S}
        role="img"
        aria-label={`Easing curve ${formatBezier(b)}`}
        className="self-center"
        style={{ touchAction: 'none', background: '#fafafa', borderRadius: 6 }}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerLeave={end}
      >
        <rect x={toX(0)} y={toY(1)} width={toX(1) - toX(0)} height={toY(0) - toY(1)} fill="none" stroke="#ececec" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(1)} stroke="#e0e0e0" strokeDasharray="3 3" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(b[0])} y2={toY(b[1])} stroke="#3B82F6" strokeWidth="1" />
        <line x1={toX(1)} y1={toY(1)} x2={toX(b[2])} y2={toY(b[3])} stroke="#3B82F6" strokeWidth="1" />
        <path d={curve} fill="none" stroke="#111" strokeWidth="2" />
        {([0, 1] as const).map((h) => (
          <circle
            key={h}
            cx={toX(b[h * 2]!)}
            cy={toY(b[h * 2 + 1]!)}
            r="6.5"
            fill="#fff"
            stroke="#3B82F6"
            strokeWidth="2"
            tabIndex={0}
            role="slider"
            aria-label={`Handle ${h + 1}: x ${b[h * 2]!.toFixed(2)}, y ${b[h * 2 + 1]!.toFixed(2)}. Arrow keys move it.`}
            aria-valuenow={b[h * 2 + 1]}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              drag.current = h;
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onKeyDown={(e) => {
              const st = e.shiftKey ? 0.1 : 0.02;
              const m: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] };
              const d = m[e.key];
              if (d) (e.preventDefault(), nudge(h, d[0], d[1]));
            }}
          />
        ))}
        <text x={toX(1) - 2} y={S - 2} textAnchor="end" fontSize="9" fill="#b5b5b5">
          time →
        </text>
      </svg>
      <input
        className="fc-input mono"
        aria-label="Easing (CSS)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const p = parseEasing(text);
          if (p) onChange(formatBezier(p));
          else setText(parsed ? formatBezier(parsed) : easing);
        }}
      />
      <div aria-hidden style={{ position: 'relative', blockSize: 14, marginInline: 4 }}>
        <div style={{ position: 'absolute', insetInline: 0, insetBlockStart: 6, blockSize: 2, background: '#efefef', borderRadius: 1 }} />
        <span ref={dot} style={{ position: 'absolute', insetBlockStart: 1, insetInlineStart: 0, inlineSize: 12, blockSize: 12, borderRadius: 6, background: '#3B82F6' }} />
      </div>
    </div>
  );
}
