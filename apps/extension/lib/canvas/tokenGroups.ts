import type { Token } from '@flowcanvas/protocol';

export type TokenGroup = 'Colour' | 'Font family' | 'Type scale' | 'Spacing' | 'Radius' | 'Other';
export const GROUP_ORDER: TokenGroup[] = ['Colour', 'Font family', 'Type scale', 'Spacing', 'Radius', 'Other'];

export function tokenGroup(t: Token): TokenGroup {
  const n = t.name.toLowerCase();
  if (t.type === 'color') return 'Colour';
  if (t.type === 'font' || /font-?family|--font-(display|sans|serif|mono|body)$/.test(n)) return 'Font family';
  if (/radius|rounded/.test(n)) return 'Radius';
  if (/(font|text|type|size|leading|display|title|body|caption|heading)/.test(n) && t.type === 'length') return 'Type scale';
  if (/(space|spacing|gap|gutter|pad|margin|section|inset)/.test(n) && t.type === 'length') return 'Spacing';
  return t.type === 'length' ? 'Spacing' : 'Other';
}

export function groupTokens(tokens: Token[]): Array<{ group: TokenGroup; tokens: Token[] }> {
  const m = new Map<TokenGroup, Token[]>();
  for (const t of tokens) {
    const g = tokenGroup(t);
    m.set(g, [...(m.get(g) ?? []), t]);
  }
  return GROUP_ORDER.filter((g) => m.has(g)).map((g) => ({ group: g, tokens: m.get(g)! }));
}

/** Short label: "--font-size-display" → "display" within its group. */
export function shortName(name: string): string {
  const parts = name.replace(/^--/, '').split('-');
  return parts.length > 1 ? parts.slice(-1)[0]! : parts[0]!;
}

/** Split "16px" / "1.5rem" into number + unit for the slider. */
export function splitLength(v: string): { n: number; unit: string } | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em|%|vh|vw)$/.exec(v.trim());
  return m ? { n: Number(m[1]), unit: m[2]! } : null;
}

export function sliderMax(n: number, unit: string, group: TokenGroup): number {
  if (unit === 'rem' || unit === 'em') return Math.max(4, Math.ceil(n * 3));
  if (group === 'Radius') return Math.max(48, Math.ceil(n * 2));
  return Math.max(64, Math.ceil(n * 3));
}

/** Coalesce rapid calls into one per animation frame (token slider streaming, motion rule 8). */
export function rafThrottle<T>(fn: (v: T) => void): (v: T) => void {
  let pending: T | undefined;
  let scheduled = false;
  return (v: T) => {
    pending = v;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(pending as T);
    });
  };
}
