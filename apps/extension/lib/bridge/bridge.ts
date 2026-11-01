/**
 * Bridge core (isolated world). Talks to the canvas over postMessage and to
 * the app SDK / MAIN-world helper over in-page CustomEvents.
 * Kept free of extension APIs so it can be tested in happy-dom.
 */
import {
  AUTO_READY_MS,
  BRIDGE_TO_MAIN_EVENT,
  BRIDGE_TO_SDK_EVENT,
  CANVAS_TO_FRAME,
  MAIN_EVENT,
  PROTOCOL_VERSION,
  SDK_EVENT,
  emitInPage,
  onInPage,
  parseMessage,
  type BridgeToMain,
  type BridgeToSdk,
  type MainToBridge,
  type Message,
  type SdkToBridge,
} from '@flowcanvas/protocol';
import { collectLinks, cleanPath } from '../url';
import { WINDOW_NAME_PREFIX, frameIdentity } from '../frame';
import { elementContext, rectOf } from './element';
import { buildSelector, clickTarget, visibleText } from './selector';
import { applyTokens, readTokens } from './tokens';
import { createCapturer, type CaptureFn } from './capture';

type Outgoing = { [K in Message['fc']]: Omit<Extract<Message, { fc: K }>, 'v' | 'frame' | 'nonce'> & { fc: K } }[Message['fc']];

export interface BridgeEnv {
  win: Window;
  /** chrome-extension://<id> */
  extensionOrigin: string;
  autoReadyMs?: number;
  /** Loads the screenshot library on demand (injected by the background). Absent in tests. */
  loadCapturer?: () => Promise<CaptureFn | null>;
}

export interface Bridge {
  readonly frame: string;
  stop(): void;
}

export function startBridge(env: BridgeEnv): Bridge | null {
  const { win, extensionOrigin } = env;
  const id = frameIdentity(win);
  if (!id) return null;
  const doc = win.document;
  const frame = id.frame;
  if (!win.name.startsWith(WINDOW_NAME_PREFIX)) win.name = WINDOW_NAME_PREFIX + frame;

  let nonce: string | null = null;
  let canvasState: string | null = null;
  let sdkWaiting = false;
  let readySent = false;
  let lastMocks: BridgeToMain | null = null;
  let recording = false;
  /** Player stage: selectors whose clicks are reported and cancelled. */
  let intercept: string[] = [];
  const capture = env.loadCapturer ? createCapturer(win, env.loadCapturer) : null;
  const outbox: Outgoing[] = [];
  const cleanups: Array<() => void> = [];

  const post = (m: Outgoing) => {
    const full = { ...m, v: PROTOCOL_VERSION, frame, nonce: m.fc === 'hello' ? null : nonce };
    win.parent.postMessage(full, extensionOrigin);
  };
  const send = (m: Outgoing) => {
    if (m.fc !== 'hello' && !nonce) outbox.push(m);
    else post(m);
  };
  const toSdk = (m: BridgeToSdk) => emitInPage(BRIDGE_TO_SDK_EVENT, m, win);
  const toMain = (m: BridgeToMain) => emitInPage(BRIDGE_TO_MAIN_EVENT, m, win);
  const here = () => cleanPath(win.location.href);

  const sendReady = () => {
    if (readySent) return;
    readySent = true;
    send({ fc: 'ready', url: here() });
  };

  const onClick = (ev: Event) => {
    const t = ev.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    for (const sel of intercept) {
      let hit: Element | null = null;
      try {
        hit = t.closest(sel);
      } catch {
        hit = null;
      }
      if (hit) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        send({ fc: 'click', target: sel, text: visibleText(hit), rect: rectOf(hit) });
        return;
      }
    }
    if (!recording) return;
    const el = clickTarget(t);
    send({ fc: 'click', target: buildSelector(el), text: visibleText(el), rect: rectOf(el) });
  };
  let listening = false;
  /** `sel` omitted keeps the current intercept list (a global record toggle must not drop the Player's targets). */
  const setRecording = (on: boolean, sel?: string[]) => {
    recording = on;
    if (sel) intercept = sel;
    const want = recording || intercept.length > 0;
    if (want === listening) return;
    listening = want;
    if (want) win.addEventListener('click', onClick, true);
    else win.removeEventListener('click', onClick, true);
  };

  const handle = (msg: Message) => {
    switch (msg.fc) {
      case 'welcome':
        nonce = msg.nonce;
        canvasState = msg.state;
        for (const m of outbox.splice(0)) post(m);
        if (sdkWaiting) toSdk({ type: 'welcome', state: canvasState });
        break;
      case 'mocks':
        lastMocks = { type: 'mocks', rules: msg.rules };
        toMain(lastMocks);
        break;
      case 'query': {
        let el: Element | null = null;
        try {
          el = doc.querySelector(msg.selector);
        } catch {
          el = null;
        }
        send({ fc: 'query-result', id: msg.id, found: !!el, rect: el ? rectOf(el) : null });
        break;
      }
      case 'tokens-request':
        send({ fc: 'tokens-read', tokens: readTokens(doc) });
        break;
      case 'tokens':
        applyTokens(doc, msg.vars);
        toSdk({ type: 'tokens', vars: msg.vars });
        break;
      case 'record':
        setRecording(msg.on, msg.intercept);
        break;
      case 'element-at': {
        const el = doc.elementFromPoint(msg.x, msg.y);
        send({ fc: 'element-result', id: msg.id, element: el ? elementContext(el) : null });
        break;
      }
      case 'links':
        send({ fc: 'links-result', id: msg.id, links: collectLinks(doc) });
        break;
      case 'capture': {
        const id = msg.id;
        if (!capture) {
          send({ fc: 'capture-result', id, webp: null, error: 'capture unavailable' });
          break;
        }
        capture(msg.scale, msg.quality).then(
          (webp) => send({ fc: 'capture-result', id, webp }),
          (e: unknown) => send({ fc: 'capture-result', id, webp: null, error: String((e as Error)?.message ?? e).slice(0, 200) }),
        );
        break;
      }
      default:
        break;
    }
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== extensionOrigin) return;
    const msg = parseMessage(ev.data);
    if (!msg || !CANVAS_TO_FRAME.includes(msg.fc) || msg.frame !== frame) return;
    if (msg.fc === 'welcome') {
      if (nonce && msg.nonce !== nonce) return; // a second welcome must keep the session nonce
    } else if (!nonce || msg.nonce !== nonce) {
      return;
    }
    handle(msg);
  };
  win.addEventListener('message', onMessage);
  cleanups.push(() => win.removeEventListener('message', onMessage));

  cleanups.push(
    onInPage<SdkToBridge>(
      SDK_EVENT,
      (m) => {
        if (m.type === 'hello') {
          if (canvasState !== null) toSdk({ type: 'welcome', state: canvasState });
          else sdkWaiting = true;
        } else if (m.type === 'screens') {
          send({ fc: 'screens', screens: m.screens });
        } else if (m.type === 'ready') {
          sendReady();
        }
      },
      win,
    ),
  );

  cleanups.push(
    onInPage<MainToBridge>(
      MAIN_EVENT,
      (m) => {
        if (m.type === 'nav') {
          const from = cleanPath(m.from);
          const to = cleanPath(m.to);
          if (from !== to) send({ fc: 'nav', from, to });
        } else if (m.type === 'main-ready') {
          if (lastMocks) toMain(lastMocks);
        } else if (m.type === 'hmr') send({ fc: 'hmr' });
      },
      win,
    ),
  );

  const autoMs = env.autoReadyMs ?? AUTO_READY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armAutoReady = () => {
    timer = setTimeout(sendReady, autoMs);
  };
  if (doc.readyState === 'complete') armAutoReady();
  else {
    win.addEventListener('load', armAutoReady, { once: true });
    cleanups.push(() => win.removeEventListener('load', armAutoReady));
  }
  cleanups.push(() => clearTimeout(timer));
  cleanups.push(() => setRecording(false));

  post({ fc: 'hello', hasSdk: false, url: here() });

  return {
    frame,
    stop() {
      for (const c of cleanups.splice(0)) c();
    },
  };
}
