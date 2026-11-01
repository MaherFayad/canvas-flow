import { guessTokenType, type Token } from '@flowcanvas/protocol';

const ROOT_SEL = /^(:root|html)$/i;

function isRootRule(r: CSSRule): r is CSSStyleRule {
  const sel = (r as CSSStyleRule).selectorText;
  return typeof sel === 'string' && sel.split(',').some((s) => ROOT_SEL.test(s.trim()));
}

function walk(rules: CSSRuleList, out: Map<string, string>): void {
  for (const r of Array.from(rules)) {
    if (isRootRule(r)) {
      const st = r.style;
      for (let i = 0; i < st.length; i++) {
        const name = st.item(i);
        if (name.startsWith('--')) out.set(name, st.getPropertyValue(name).trim());
      }
    }
    // @media, @supports, @layer and nesting all expose cssRules.
    const inner = (r as CSSGroupingRule).cssRules;
    if (inner && inner.length) walk(inner, out);
  }
}

/** CSS custom properties declared on :root / html in same-origin stylesheets. */
export function readTokens(doc: Document): Token[] {
  const found = new Map<string, string>();
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    walk(rules, found);
  }
  const view = doc.defaultView;
  const cs = view ? view.getComputedStyle(doc.documentElement) : null;
  const tokens: Token[] = [];
  for (const [name, declared] of found) {
    const live = cs?.getPropertyValue(name).trim();
    const value = live || declared;
    tokens.push({ name, value, type: guessTokenType(value) });
  }
  return tokens;
}

export function applyTokens(doc: Document, vars: Record<string, string>): void {
  const st = doc.documentElement.style;
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith('--')) continue;
    if (v === '') st.removeProperty(k);
    else st.setProperty(k, v);
  }
}
