import { useLayoutEffect, useRef, useState } from 'react';

/** Segmented control whose active pill slides between options (UI_REFERENCE motion rule 6). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'light',
  grid3 = false,
  render,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  variant?: 'light' | 'dark';
  grid3?: boolean;
  render?: (v: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const idx = value === null ? -1 : options.indexOf(value);
    const btn = idx >= 0 ? (root.querySelectorAll('button')[idx] as HTMLButtonElement | undefined) : undefined;
    setPill(btn ? { x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight } : null);
  }, [value, options]);
  return (
    <div ref={ref} role="group" aria-label={label} className={`fc-seg ${variant === 'dark' ? 'dark' : ''} ${grid3 ? 'grid3' : ''}`}>
      {pill && (
        <span
          aria-hidden
          className="fc-seg-pill"
          style={{ insetInlineStart: 0, insetBlockStart: 0, inlineSize: pill.w, blockSize: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
        />
      )}
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}
