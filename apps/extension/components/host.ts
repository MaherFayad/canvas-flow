import { createContext, useContext } from 'react';
import type { FrameHost } from '@/lib/canvas/frameHost';

export const HostContext = createContext<FrameHost | null>(null);

export function useHost(): FrameHost | null {
  return useContext(HostContext);
}
