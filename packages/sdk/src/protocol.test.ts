// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { ScreenDecl } from '@flowcanvas/protocol/lite';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FcScreen } from './index';

describe('SDK and protocol', () => {
  it('FcScreen is structurally the protocol ScreenDecl', () => {
    expectTypeOf<FcScreen>().toEqualTypeOf<ScreenDecl>();
  });

  it('runtime imports come only from the zod-free protocol/lite entry', () => {
    for (const f of ['index.ts', 'react.ts', 'next.ts', 'vue.ts', 'msw.ts', 'prod.ts', 'vite.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      const runtime = [...src.matchAll(/^import (?!type )[^;]*from ['"](@flowcanvas\/protocol[^'"]*)['"]/gm)].map((m) => m[1]);
      for (const spec of runtime) expect(spec, `${f} imports ${spec}`).toBe('@flowcanvas/protocol/lite');
      expect(src).not.toMatch(/from ['"]zod['"]/);
    }
  });
});
