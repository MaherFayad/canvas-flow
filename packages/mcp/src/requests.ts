/**
 * Canvas requests: things the user asked for from the canvas ("Discover with
 * Claude") that Claude picks up the next time it talks to the server. MCP
 * clients cannot be woken reliably, so requests wait here (in memory, for the
 * life of the server) and show in get_project, list_requests and the
 * flowcanvas://requests resource.
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

export const REQUEST_KINDS = ['discover'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export interface CanvasRequest {
  id: string;
  kind: RequestKind;
  status: 'pending' | 'done';
  /** What the user wants, written for Claude. */
  text: string;
  /** Prompt (MCP prompt name) that does the work. */
  prompt?: string;
  note?: string;
  createdAt: string;
  doneAt?: string;
  summary?: string;
}

const TEXT: Record<RequestKind, { text: string; prompt: string }> = {
  discover: {
    text: 'The user clicked "Discover with Claude" on the canvas: read the app code and fill the canvas with its screens, routes and states. Follow the discover_screens prompt (or the flowcanvas://recipes/discover resource), then call complete_request with a one-line summary.',
    prompt: 'discover_screens',
  },
};

/** Events: 'change' (list). */
export class RequestQueue extends EventEmitter {
  private items: CanvasRequest[] = [];

  list(status: 'pending' | 'done' | 'all' = 'pending'): CanvasRequest[] {
    return this.items.filter((r) => status === 'all' || r.status === status).map((r) => ({ ...r }));
  }

  get(id: string): CanvasRequest | undefined {
    const r = this.items.find((x) => x.id === id);
    return r ? { ...r } : undefined;
  }

  /** Add a request; a pending one of the same kind is reused (clicking twice asks once). */
  add(kind: RequestKind, note?: string): { request: CanvasRequest; created: boolean } {
    const open = this.items.find((r) => r.kind === kind && r.status === 'pending');
    if (open) {
      if (note) open.note = note;
      return { request: { ...open }, created: false };
    }
    const r: CanvasRequest = {
      id: `req-${randomBytes(3).toString('hex')}`,
      kind,
      status: 'pending',
      ...TEXT[kind],
      ...(note ? { note } : {}),
      createdAt: new Date().toISOString(),
    };
    this.items.push(r);
    if (this.items.length > 50) this.items = this.items.slice(-50);
    this.emit('change', this.list('all'));
    return { request: { ...r }, created: true };
  }

  complete(id: string, summary?: string): CanvasRequest | null {
    const r = this.items.find((x) => x.id === id);
    if (!r) return null;
    r.status = 'done';
    r.doneAt = new Date().toISOString();
    if (summary) r.summary = summary;
    this.emit('change', this.list('all'));
    return { ...r };
  }
}
