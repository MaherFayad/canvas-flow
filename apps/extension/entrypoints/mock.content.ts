import { defineContentScript } from 'wxt/utils/define-content-script';
import { startMain } from '@/lib/main/main';

/** MAIN world: history patch, HMR watch, fetch/XHR mock layer. Passive outside canvas frames. */
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'],
  runAt: 'document_start',
  allFrames: true,
  world: 'MAIN',
  main() {
    startMain(window);
  },
});
