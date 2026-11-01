/** State badge colors. The badge always shows the state name as text, never color alone. */
const BADGE: Record<string, { bg: string; fg: string }> = {
  default: { bg: '#E5E7EB', fg: '#374151' },
  loading: { bg: '#FEF3C7', fg: '#92400E' },
  empty: { bg: '#DBEAFE', fg: '#1E40AF' },
  partial: { bg: '#EDE9FE', fg: '#5B21B6' },
  error: { bg: '#FEE2E2', fg: '#991B1B' },
  success: { bg: '#DCFCE7', fg: '#166534' },
};

export function badgeColors(state: string): { bg: string; fg: string } {
  return BADGE[state.toLowerCase()] ?? BADGE.default!;
}

export const SECTION_TINT: Record<string, { bg: string; border: string; fg: string }> = {
  grey: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(100,116,139,0.45)', fg: '#334155' },
  blue: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(37,99,235,0.45)', fg: '#1E3A8A' },
  green: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(22,163,74,0.45)', fg: '#14532D' },
  amber: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(217,119,6,0.45)', fg: '#78350F' },
  red: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(220,38,38,0.45)', fg: '#7F1D1D' },
  purple: { bg: 'rgba(139,92,246,0.08)', border: 'rgba(124,58,237,0.45)', fg: '#4C1D95' },
};
