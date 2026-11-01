/** Test helpers: pretend to be a canvas frame and play the bridge. Not part of the build. */
import { BRIDGE_TO_SDK_EVENT, SDK_EVENT, emitInPage, onInPage, type BridgeToSdk, type SdkToBridge } from '@flowcanvas/protocol/lite';

const realTop = Object.getOwnPropertyDescriptor(window, 'top');

export function enterFrame(search: string): void {
  Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
  window.history.replaceState(null, '', `/catalog${search}`);
}

export function leaveFrame(): void {
  if (realTop) Object.defineProperty(window, 'top', realTop);
  window.history.replaceState(null, '', '/');
}

/** Records what the SDK sends and lets the test answer as the bridge. */
export function fakeBridge() {
  const sent: SdkToBridge[] = [];
  const off = onInPage<SdkToBridge>(SDK_EVENT, (m) => sent.push(m));
  return {
    sent,
    off,
    reply: (m: BridgeToSdk) => emitInPage(BRIDGE_TO_SDK_EVENT, m),
  };
}

export async function freshSdk() {
  const { vi } = await import('vitest');
  vi.resetModules();
  return import('./index');
}
