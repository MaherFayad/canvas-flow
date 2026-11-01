/**
 * Studio "photos" of the pieces, drawn in SVG so the demo ships no third-party
 * images: soft window light from the left, a table plane, a long blurred shadow
 * and glaze shading. Decorative only (aria-hidden); the text next to it names the piece.
 */
import { useId, type ReactNode } from 'react';
import type { PotteryClass, Product, Shape } from '../data';

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
/** Mix colour `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('');
}
const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
const darken = (c: string, t: number) => mix(c, '#1a1410', t);

interface Ids {
  bg: string;
  table: string;
  light: string;
  glaze: string;
  inner: string;
  blur: string;
  soft: string;
}

function useIds(): Ids {
  const base = useId().replace(/[^a-zA-Z0-9]/g, '');
  return { bg: `bg${base}`, table: `tb${base}`, light: `lt${base}`, glaze: `gl${base}`, inner: `in${base}`, blur: `bl${base}`, soft: `sf${base}` };
}

function Stage({ ids, backdrop, children, className }: { ids: Ids; backdrop: string; children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" className={`photo ${className ?? ''}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ids.bg} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={lighten(backdrop, 0.45)} />
          <stop offset="0.6" stopColor={backdrop} />
          <stop offset="1" stopColor={darken(backdrop, 0.08)} />
        </linearGradient>
        <linearGradient id={ids.table} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={lighten(backdrop, 0.55)} />
          <stop offset="1" stopColor={lighten(backdrop, 0.1)} />
        </linearGradient>
        <radialGradient id={ids.light} cx="0.12" cy="0.1" r="0.9">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={ids.soft} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${ids.bg})`} />
      <path d="M0 262 Q200 248 400 262 V400 H0Z" fill={`url(#${ids.table})`} />
      {children}
      <rect width="400" height="400" fill={`url(#${ids.light})`} />
    </svg>
  );
}

function GlazeDefs({ ids, color }: { ids: Ids; color: string }) {
  return (
    <defs>
      <linearGradient id={ids.glaze} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={lighten(color, 0.38)} />
        <stop offset="0.3" stopColor={lighten(color, 0.08)} />
        <stop offset="0.75" stopColor={color} />
        <stop offset="1" stopColor={darken(color, 0.3)} />
      </linearGradient>
      <radialGradient id={ids.inner} cx="0.62" cy="0.62" r="0.7">
        <stop offset="0" stopColor={lighten(color, 0.2)} />
        <stop offset="0.7" stopColor={color} />
        <stop offset="1" stopColor={darken(color, 0.28)} />
      </radialGradient>
    </defs>
  );
}

function Shadow({ ids, d, opacity = 0.32 }: { ids: Ids; d: string; opacity?: number }) {
  return <path d={d} fill="#2a2018" opacity={opacity} filter={`url(#${ids.blur})`} />;
}

function Piece({ shape, color, garnish, ids }: { shape: Shape; color: string; garnish?: Product['garnish']; ids: Ids }) {
  const g = `url(#${ids.glaze})`;
  const inner = `url(#${ids.inner})`;
  const rim = lighten(color, 0.45);
  switch (shape) {
    case 'mug':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M150 300 L380 330 L390 350 L170 318 Z" />
          <path d="M248 186 C300 182 306 262 248 262" fill="none" stroke={darken(color, 0.12)} strokeWidth="15" strokeLinecap="round" />
          <path d="M138 140 L252 140 L252 292 C252 304 240 312 195 312 C150 312 138 304 138 292 Z" fill={g} />
          <ellipse cx="195" cy="140" rx="57" ry="13" fill={darken(color, 0.35)} />
          <ellipse cx="195" cy="140" rx="57" ry="13" fill="none" stroke={rim} strokeWidth="3" />
        </g>
      );
    case 'cup':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M110 300 L370 322 L380 345 L130 330 Z" />
          <ellipse cx="200" cy="300" rx="112" ry="24" fill={lighten(color, 0.15)} />
          <ellipse cx="200" cy="296" rx="96" ry="18" fill={darken(color, 0.06)} />
          <path d="M270 222 C312 222 312 268 262 266" fill="none" stroke={darken(color, 0.1)} strokeWidth="11" strokeLinecap="round" />
          <path d="M128 208 L272 208 C270 262 246 298 200 298 C154 298 130 262 128 208 Z" fill={g} />
          <ellipse cx="200" cy="208" rx="72" ry="15" fill={rim} />
          <ellipse cx="200" cy="209" rx="64" ry="11" fill="#6B4429" />
          <ellipse cx="203" cy="210" rx="44" ry="7" fill="#C49064" opacity="0.85" />
          {garnish === 'pour' && (
            <>
              <path d="M300 -10 L400 -10 L400 70 C370 86 330 80 300 60 C276 46 258 40 236 46 L230 36 C252 22 276 18 300 -10 Z" fill="#2B2622" />
              <path d="M300 -10 L330 -10 C318 20 300 34 282 40 L262 40 C280 30 292 16 300 -10 Z" fill="#fff" opacity="0.12" />
              <path d="M232 42 C222 60 214 100 210 150 C208 180 206 196 205 208 L213 208 C213 196 214 178 216 150 C219 104 226 66 238 46 Z" fill="#5A3721" />
              <path d="M231 48 C223 70 217 110 214 160" fill="none" stroke="#9A6A45" strokeWidth="1.5" opacity="0.7" />
            </>
          )}
        </g>
      );
    case 'bowl':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M110 292 L370 318 L380 340 L130 320 Z" />
          <path d="M88 190 C92 262 140 304 200 304 C260 304 308 262 312 190 Z" fill={g} />
          <ellipse cx="200" cy="190" rx="112" ry="30" fill={inner} />
          <ellipse cx="200" cy="190" rx="112" ry="30" fill="none" stroke={rim} strokeWidth="3" />
          <ellipse cx="214" cy="198" rx="70" ry="14" fill={lighten(color, 0.3)} opacity="0.35" />
        </g>
      );
    case 'wide-bowl':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M90 270 L380 300 L380 330 L110 312 Z" opacity={0.26} />
          <path d="M58 212 C62 260 120 300 200 300 C280 300 338 260 342 212 Z" fill={lighten(color, 0.55)} />
          <ellipse cx="200" cy="212" rx="142" ry="74" fill={lighten(color, 0.62)} />
          <ellipse cx="200" cy="216" rx="122" ry="60" fill={inner} />
          <ellipse cx="226" cy="232" rx="58" ry="24" fill={lighten(color, 0.35)} opacity="0.4" />
        </g>
      );
    case 'plate':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M70 260 L380 288 L384 318 L90 300 Z" opacity={0.22} />
          <ellipse cx="200" cy="232" rx="152" ry="86" fill={darken(color, 0.08)} />
          <ellipse cx="200" cy="226" rx="152" ry="86" fill={lighten(color, 0.4)} />
          <ellipse cx="200" cy="226" rx="140" ry="78" fill="none" stroke={darken(color, 0.07)} strokeWidth="9" strokeDasharray="5 7" />
          <ellipse cx="204" cy="230" rx="98" ry="52" fill={inner} />
          {garnish === 'egg' && (
            <>
              <ellipse cx="214" cy="236" rx="30" ry="18" fill="#000" opacity="0.12" filter={`url(#${ids.soft})`} />
              <ellipse cx="208" cy="230" rx="30" ry="18" fill="#FBF8F1" />
              <circle cx="212" cy="228" r="10" fill="#E9A23B" />
              <circle cx="209" cy="225" r="3" fill="#F6CF7E" />
            </>
          )}
        </g>
      );
    case 'egg-cup':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M150 300 L360 322 L366 342 L166 322 Z" />
          <ellipse cx="200" cy="300" rx="58" ry="13" fill={darken(color, 0.1)} />
          <path d="M168 300 C176 270 186 262 192 250 L208 250 C214 262 224 270 232 300 Z" fill={g} />
          <path d="M140 196 L260 196 C258 236 236 256 200 256 C164 256 142 236 140 196 Z" fill={g} />
          <path d="M146 210 V244 M162 220 V252 M182 226 V256 M218 226 V256 M238 220 V252 M254 210 V244" stroke={darken(color, 0.12)} strokeWidth="3" opacity="0.5" />
          <path d="M162 196 C160 140 182 110 200 110 C218 110 240 140 238 196 Z" fill="#F4EAD7" />
          <path d="M214 120 C232 136 238 166 236 196 L226 196 C228 166 224 140 214 120 Z" fill="#000" opacity="0.07" />
          <ellipse cx="200" cy="196" rx="60" ry="12" fill={rim} />
        </g>
      );
    case 'candle':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M110 300 L370 322 L380 344 L130 324 Z" />
          <ellipse cx="200" cy="300" rx="104" ry="24" fill={darken(color, 0.12)} />
          <ellipse cx="200" cy="294" rx="104" ry="24" fill={g} />
          <ellipse cx="200" cy="292" rx="84" ry="16" fill={inner} />
          <path d="M172 290 V240 H228 V290 C228 296 172 296 172 290Z" fill={g} />
          <ellipse cx="200" cy="240" rx="28" ry="7" fill={rim} />
          <rect x="190" y="96" width="20" height="146" rx="3" fill="#FBF6EA" />
          <rect x="203" y="96" width="7" height="146" fill="#000" opacity="0.06" />
          <circle cx="200" cy="74" r="26" fill="#FFD68A" opacity="0.35" filter={`url(#${ids.soft})`} />
          <path d="M200 58 C210 72 208 86 200 90 C192 86 190 72 200 58 Z" fill="#F2A33A" />
          <path d="M200 70 C204 78 203 85 200 87 C197 85 196 78 200 70 Z" fill="#FFE7A8" />
        </g>
      );
    case 'tray':
      return (
        <g>
          <GlazeDefs ids={ids} color={color} />
          <Shadow ids={ids} d="M60 262 L384 290 L388 322 L80 304 Z" opacity={0.24} />
          <ellipse cx="200" cy="238" rx="168" ry="70" fill={darken(color, 0.15)} />
          <ellipse cx="200" cy="230" rx="168" ry="70" fill={lighten(color, 0.2)} />
          <ellipse cx="202" cy="234" rx="148" ry="56" fill={inner} />
          {[[150, 220], [214, 238], [270, 214]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" fill={darken(color, 0.4)} opacity="0.5" />
          ))}
        </g>
      );
  }
}

export function ProductPhoto({ product, className }: { product: Pick<Product, 'shape' | 'color' | 'backdrop'> & { garnish?: Product['garnish'] }; className?: string }) {
  const ids = useIds();
  return (
    <Stage ids={ids} backdrop={product.backdrop} className={className}>
      <Piece shape={product.shape} color={product.color} garnish={product.garnish} ids={ids} />
    </Stage>
  );
}

/** Top-down table laid for dinner: the hero of the welcome collage. */
export function TablePhoto({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const dish = (cx: number, cy: number, r: number, glaze: string, food?: string[]) => (
    <g key={`${cx}-${cy}`}>
      <circle cx={cx + 8} cy={cy + 10} r={r} fill="#3a2a1c" opacity="0.3" filter={`url(#b${id})`} />
      <circle cx={cx} cy={cy} r={r} fill={darken(glaze, 0.1)} />
      <circle cx={cx - r * 0.03} cy={cy - r * 0.03} r={r * 0.97} fill={glaze} />
      <circle cx={cx} cy={cy} r={r * 0.74} fill={darken(glaze, 0.07)} />
      <circle cx={cx + r * 0.05} cy={cy + r * 0.05} r={r * 0.7} fill={lighten(glaze, 0.08)} />
      {food?.flatMap((f, i) =>
        Array.from({ length: 5 }, (_, k) => {
          const a = (i / food.length) * Math.PI * 2 + k * 0.5;
          const d = r * (0.18 + ((k * 37 + i * 13) % 30) / 100);
          return <circle key={`${i}-${k}`} cx={cx + Math.cos(a) * d} cy={cy + Math.sin(a) * d} r={r * (0.1 + ((k * 7 + i) % 5) / 40)} fill={k % 2 ? darken(f, 0.12) : f} />;
        }),
      )}
      <path d={`M${cx - r * 0.8} ${cy - r * 0.45} A ${r * 0.92} ${r * 0.92} 0 0 1 ${cx - r * 0.2} ${cy - r * 0.9}`} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth={r * 0.06} strokeLinecap="round" />
    </g>
  );
  return (
    <svg viewBox="0 0 300 460" preserveAspectRatio="xMidYMid slice" className={`photo ${className ?? ''}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E9DFCD" />
          <stop offset="1" stopColor="#C9B697" />
        </linearGradient>
        <radialGradient id={`l${id}`} cx="0.2" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#FFF6E2" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFF6E2" stopOpacity="0" />
        </radialGradient>
        <filter id={`b${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect width="300" height="460" fill={`url(#t${id})`} />
      {Array.from({ length: 46 }, (_, i) => (
        <path key={i} d={`M0 ${i * 10 + 3} H300`} stroke="#fff" strokeOpacity="0.07" strokeWidth="1" />
      ))}
      <path d="M-10 0 H96 C80 120 92 300 70 470 H-10Z" fill="#8E6B4E" opacity="0.32" />
      <path d="M96 0 C80 120 92 300 70 470" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" />
      {dish(170, 110, 62, '#F2ECDF', ['#D98C3A', '#7E8E4E', '#B0413E', '#E6C46B'])}
      {dish(70, 210, 38, '#8C9BC8', ['#7E8E4E', '#9AAB5E'])}
      {dish(210, 250, 46, '#F0E8D8', ['#B0413E', '#C9563A', '#E2A64B'])}
      {dish(110, 330, 54, '#E59E4E', ['#F2ECDF', '#7E8E4E', '#D9CDB4'])}
      {dish(240, 380, 30, '#F2ECDF', ['#5E3B26'])}
      {dish(50, 420, 34, '#D8C3A0', ['#B0413E', '#E6C46B'])}
      {dish(250, 30, 26, '#8B9670')}
      <rect width="300" height="460" fill={`url(#l${id})`} />
    </svg>
  );
}

/** Warm studio interior with a wheel at work: the class photo. */
export function StudioPhoto({ tone = 'wheel', className }: { tone?: PotteryClass['tone']; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const wall = tone === 'glaze' ? '#6E4B3A' : tone === 'clay' ? '#7A4529' : '#7B3F22';
  const pots = ['#C98E5B', '#E8DCC6', '#8C9BC8', '#B86B4B', '#D8C3A0', '#E59E4E', '#EFE7D6'];
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className={`photo ${className ?? ''}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`w${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={darken(wall, 0.25)} />
          <stop offset="1" stopColor={lighten(wall, 0.12)} />
        </linearGradient>
        <linearGradient id={`d${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B88A62" />
          <stop offset="1" stopColor="#8E6443" />
        </linearGradient>
        <radialGradient id={`g${id}`} cx="0.25" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#FFD9A0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFD9A0" stopOpacity="0" />
        </radialGradient>
        <filter id={`b${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="400" height="300" fill={`url(#w${id})`} />
      {[70, 130].map((y, row) => (
        <g key={y}>
          <rect x="0" y={y} width="400" height="7" fill={darken(wall, 0.45)} />
          {pots.map((c, i) => {
            const x = 30 + i * 58 + row * 22;
            const w = 12 + ((i + row) % 3) * 4;
            const h = 18 + ((i * 2 + row) % 3) * 7;
            return (
              <g key={i}>
                <path d={`M${x - w} ${y} C${x - w - 4} ${y - h * 0.6} ${x - w * 0.5} ${y - h} ${x - w * 0.45} ${y - h} H${x + w * 0.45} C${x + w * 0.5} ${y - h} ${x + w + 4} ${y - h * 0.6} ${x + w} ${y} Z`} fill={c} opacity="0.92" />
                <path d={`M${x + w * 0.2} ${y - h + 2} C${x + w * 0.9} ${y - h * 0.6} ${x + w * 0.8} ${y - 4} ${x + w * 0.5} ${y}`} fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="5" />
              </g>
            );
          })}
        </g>
      ))}
      <path d="M0 196 H400 V300 H0Z" fill={`url(#d${id})`} />
      <ellipse cx="214" cy="236" rx="120" ry="26" fill="#2a1a10" opacity="0.4" filter={`url(#b${id})`} />
      <ellipse cx="200" cy="226" rx="112" ry="24" fill="#5B5550" />
      <ellipse cx="200" cy="222" rx="112" ry="24" fill="#8A847D" />
      <ellipse cx="200" cy="220" rx="64" ry="13" fill="#6E6862" />
      <path d="M150 218 C152 186 170 170 200 170 C230 170 248 186 250 218 Z" fill="#B88760" />
      <ellipse cx="200" cy="172" rx="50" ry="9" fill="#9C6F4C" />
      <path d="M160 214 C162 190 176 178 194 176" fill="none" stroke="#D6AA80" strokeWidth="4" opacity="0.6" />
      <rect width="400" height="300" fill={`url(#g${id})`} />
    </svg>
  );
}
