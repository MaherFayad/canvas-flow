import * as protocol from '@flowcanvas/protocol';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as wire from './wire';

describe('wire constants mirror protocol', () => {
  it.each([
    'PARAM_FRAME',
    'PARAM_STATE',
    'SDK_EVENT',
    'BRIDGE_TO_SDK_EVENT',
    'SDK_HANDSHAKE_TIMEOUT_MS',
    'AUTO_READY_MS',
  ] as const)('%s', (k) => {
    expect(wire[k]).toBe(protocol[k]);
  });

  it('FcScreen is structurally the protocol ScreenDecl', () => {
    expectTypeOf<wire.FcScreen>().toEqualTypeOf<protocol.ScreenDecl>();
  });

  it('uses the same in-page transport as protocol', () => {
    const got: unknown[] = [];
    const off = protocol.onInPage('x:test', (m) => got.push(m));
    wire.emitInPage('x:test', { type: 'hello' });
    const off2 = wire.onInPage('x:test2', (m) => got.push(m));
    protocol.emitInPage('x:test2', { type: 'ready' });
    off();
    off2();
    expect(got).toEqual([{ type: 'hello' }, { type: 'ready' }]);
  });
});
