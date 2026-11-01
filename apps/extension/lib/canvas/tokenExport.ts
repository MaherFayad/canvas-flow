/**
 * Token export (feature 7): W3C Design Tokens (DTCG) JSON and a CSS `:root` block.
 * Values are the effective ones: the app's base value, then committed
 * overrides, then the live draft.
 */
import type { Token } from '@flowcanvas/protocol';
import { groupTokens, shortName, type TokenGroup } from './tokenGroups';

const GROUP_KEY: Record<TokenGroup, string> = {
  Colour: 'color',
  'Font family': 'fontFamily',
  'Type scale': 'fontSize',
  Spacing: 'spacing',
  Radius: 'radius',
  Other: 'other',
};

const DTCG_TYPE: Record<Token['type'], string | undefined> = {
  color: 'color',
  length: 'dimension',
  font: 'fontFamily',
  number: 'number',
  other: undefined,
};

export type DtcgToken = { $value: string | number | string[]; $type?: string; $extensions: { 'dev.flowcanvas': { cssVar: string } } };
export type DtcgFile = Record<string, Record<string, DtcgToken>>;

export function effectiveValues(base: Token[], overrides: Record<string, string>, draft: Record<string, string> = {}): Token[] {
  return base.map((t) => ({ ...t, value: draft[t.name] ?? overrides[t.name] ?? t.value }));
}

function fontList(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function toDtcg(tokens: Token[]): DtcgFile {
  const out: DtcgFile = {};
  for (const g of groupTokens(tokens)) {
    const group: Record<string, DtcgToken> = {};
    for (const t of g.tokens) {
      let key = shortName(t.name);
      if (key in group) key = t.name.replace(/^--/, '');
      const type = DTCG_TYPE[t.type];
      const value = t.type === 'font' ? fontList(t.value) : t.type === 'number' ? Number(t.value) : t.value;
      group[key] = { $value: value, ...(type ? { $type: type } : {}), $extensions: { 'dev.flowcanvas': { cssVar: t.name } } };
    }
    out[GROUP_KEY[g.group]] = group;
  }
  return out;
}

export function toCss(tokens: Token[]): string {
  const lines = tokens.map((t) => `  ${t.name}: ${t.value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/** Heuristic for the Tailwind v3 note: no colour custom properties at all on :root. */
export function needsTailwindNote(tokens: Token[] | null): boolean {
  return !!tokens && !tokens.some((t) => t.type === 'color');
}
