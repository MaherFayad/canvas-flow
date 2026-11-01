/**
 * Production build of the core: every call is a no-op and `active` is false.
 * Served through the `production` export condition (Vite, webpack, Next.js), so
 * production bundles carry a few bytes instead of the SDK.
 */
import type { Fc } from './index';

const noop = () => {};

export const fc: Fc = {
  init: noop,
  active: false,
  state: () => 'default',
  is: (name) => name === 'default',
  ready: noop,
  target: (id) => ({ 'data-fc': id }),
  on: () => noop,
};

