import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBridge } from '@/lib/bridge/bridge';

/** Isolated world. Inert unless this is a canvas frame (fc-frame + inside an iframe). */
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    startBridge({ win: window, extensionOrigin: `chrome-extension://${chrome.runtime.id}` });
  },
});
