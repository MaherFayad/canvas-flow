/**
 * Tiny JSON API for the demo, mounted on the Vite dev and preview servers.
 * When the SDK is off, the Flow Canvas mock layer intercepts these fetches.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { ADDRESS, CLASSES, INTERESTS, PRODUCTS, START_BAG, WISHLIST_IDS, bagResponse, classById, latestOrder, productById, type BagLine } from '../src/data';

type Handler = (req: IncomingMessage, body: Record<string, unknown>, m: RegExpMatchArray) => [number, unknown];

let bag: BagLine[] = START_BAG.map((l) => ({ ...l }));
const wishlist = new Set(WISHLIST_IDS);

const routes: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/home$/, () => [200, { featured: ['tall-mug-periwinkle', 'cappuccino-cup-butter'].map((id) => productById(id)) }]],
  ['GET', /^\/api\/interests$/, () => [200, { items: INTERESTS }]],
  ['GET', /^\/api\/products$/, () => [200, { items: PRODUCTS }]],
  ['GET', /^\/api\/products\/([\w-]+)$/, (_r, _b, m) => {
    const p = productById(m[1]!);
    return p ? [200, p] : [404, { error: 'not-found' }];
  }],
  ['GET', /^\/api\/wishlist$/, () => [200, { items: [...wishlist].map((id) => productById(id)) }]],
  ['POST', /^\/api\/wishlist$/, (_r, b) => {
    wishlist.add(String(b.productId));
    return [200, { items: [...wishlist].map((id) => productById(id)) }];
  }],
  ['GET', /^\/api\/bag$/, () => [200, bagResponse(bag)]],
  ['POST', /^\/api\/bag$/, (_r, b) => {
    const id = String(b.productId ?? '');
    if (!productById(id)) return [400, { error: 'unknown product' }];
    const line = bag.find((l) => l.productId === id);
    if (line) line.qty += 1;
    else bag.push({ productId: id, qty: 1 });
    return [200, bagResponse(bag)];
  }],
  ['GET', /^\/api\/address$/, () => [200, ADDRESS]],
  ['POST', /^\/api\/orders$/, (_r, b) => {
    if (String(b.card ?? '').replace(/\s/g, '').endsWith('0002')) return [402, { error: 'declined' }];
    bag = START_BAG.map((l) => ({ ...l }));
    return [201, latestOrder()];
  }],
  ['GET', /^\/api\/orders\/latest$/, () => [200, latestOrder()]],
  ['GET', /^\/api\/classes$/, () => [200, { items: CLASSES }]],
  ['GET', /^\/api\/classes\/([\w-]+)$/, (_r, _b, m) => {
    const c = classById(m[1]!);
    return c ? [200, c] : [404, { error: 'not-found' }];
  }],
  ['POST', /^\/api\/bookings$/, (_r, b) => [201, { ref: 'CL-3307', classTitle: classById(String(b.classId))?.title ?? '', date: String(b.date ?? ''), seats: Number(b.seats ?? 1) }]],
];

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (req.method === 'GET') return resolve({});
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '').split('?')[0]!;
  if (!path.startsWith('/api/')) return next();
  for (const [method, re, fn] of routes) {
    const m = path.match(re);
    if (m && req.method === method) {
      const [status, body] = fn(req, await readBody(req), m);
      // a little latency so loading states are real
      await new Promise((r) => setTimeout(r, 120));
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
      return;
    }
  }
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not-found' }));
}

export function demoApi(): Plugin {
  return {
    name: 'helka-demo-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
