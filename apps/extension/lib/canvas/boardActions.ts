/**
 * Store actions for sections, notes, images and comments. Each call is one
 * undo step (it goes through useProject.update).
 */
import type { CanvasImage, Comment, Device, FlowCanvasConfig, Note, Section } from '@flowcanvas/config';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { CLAUDE, ME, mentionsClaude, newComment } from './comments';
import { canvasSize, newImage, prepareImage, putBlob, rememberUrl, toBase64 } from './images';
import { newNote, type NoteKind } from './notes';
import { toRef } from './geometry';
import type { Point } from './layout';
import {
  autoLayout,
  fitToContent,
  groupSelection,
  moveSection,
  patchSection,
  ungroup,
  type Selection,
} from './sections';
import type { ClaudeLinkClient } from './mcpLink';

const announce = (s: string) => useUi.getState().set({ announce: s });
const update = (fn: (c: FlowCanvasConfig) => FlowCanvasConfig) => useProject.getState().update(fn);

/* ------------------------------ sections ------------------------------ */

export function group(sel: Selection, opts?: Parameters<typeof groupSelection>[2]): string | null {
  const r = groupSelection(useProject.getState().config, sel, opts);
  if (!r.ok) {
    announce(r.error);
    return null;
  }
  update(() => r.config);
  announce(`Grouped into ${r.config.sections.find((s) => s.id === r.id)?.title ?? 'a section'}`);
  return r.id ?? null;
}

export function ungroupSection(id: string): boolean {
  const c = useProject.getState().config;
  const r = ungroup(c, id);
  if (!r.ok) {
    announce(r.error);
    return false;
  }
  update(() => r.config);
  announce(`Ungrouped ${c.sections.find((s) => s.id === id)?.title ?? 'section'}`);
  return true;
}

export function setSection(id: string, patch: Partial<Section>) {
  update((c) => patchSection(c, id, patch));
}

export function toggleCollapse(id: string) {
  const s = useProject.getState().config.sections.find((x) => x.id === id);
  if (!s) return;
  setSection(id, { collapsed: !s.collapsed });
  announce(`${s.title} ${s.collapsed ? 'expanded' : 'collapsed; its frames are unloaded'}`);
}

export function toggleLock(id: string) {
  const s = useProject.getState().config.sections.find((x) => x.id === id);
  if (!s) return;
  setSection(id, { locked: !s.locked });
  announce(`${s.title} ${s.locked ? 'unlocked' : 'locked'}`);
}

/** `dRender` is a move in canvas pixels for `device`; stored in reference units. */
export function moveSectionBy(id: string, dRender: Point, device: Device) {
  const d = toRef(dRender, device);
  if (!d.x && !d.y) return;
  update((c) => moveSection(c, id, d));
}

export function layoutSection(id: string, mode: 'row' | 'grid') {
  update((c) => autoLayout(c, id, mode));
  announce(mode === 'row' ? 'Laid out as a row' : 'Laid out as a grid, 3 per row');
}

export function fitSection(id: string) {
  update((c) => fitToContent(c, id));
}

/* -------------------------------- notes ------------------------------- */

export function addNote(atRef: Point, section: string | null, kind: NoteKind = 'note', text = ''): Note {
  const n = { ...newNote(atRef, kind, section, ME), text };
  update((c) => ({ ...c, notes: [...c.notes, n] }));
  announce('Sticky note added. Type to write; Escape when done.');
  return n;
}

export function updateNote(id: string, fn: (n: Note) => Note) {
  update((c) => ({ ...c, notes: c.notes.map((n) => (n.id === id ? fn(n) : n)) }));
}

export function deleteNote(id: string) {
  update((c) => ({ ...c, notes: c.notes.filter((n) => n.id !== id) }));
  announce('Note deleted');
}

/* ------------------------------- images ------------------------------- */

export function updateImage(id: string, fn: (i: CanvasImage) => CanvasImage) {
  update((c) => ({ ...c, images: c.images.map((i) => (i.id === id ? fn(i) : i)) }));
}

export function deleteImage(id: string) {
  update((c) => ({
    ...c,
    images: c.images.filter((i) => i.id !== id),
    notes: c.notes.map((n) => (n.attachTo?.type === 'image' && n.attachTo.id === id ? { ...n, attachTo: null } : n)),
  }));
  announce('Image deleted');
}

/**
 * Add an image blob at `atRef` (reference units): measure, downscale if over
 * 5 MB, store in IndexedDB, and when Claude is linked also write it to the
 * project's .flowcanvas/assets/.
 */
export async function addImageBlob(blob: Blob, atRef: Point, section: string | null, link: ClaudeLinkClient | null, caption?: string): Promise<CanvasImage | null> {
  try {
    const p = await prepareImage(blob);
    await putBlob(p.file, p.blob).catch(() => undefined);
    rememberUrl(p.file, p.blob);
    const img = newImage({ file: p.file, at: atRef, size: canvasSize(p.w, p.h), section, caption });
    update((c) => ({ ...c, images: [...c.images, img] }));
    announce(`Image added${p.mime === 'image/webp' && blob.type !== 'image/webp' ? ' (scaled down to 2560 px, WebP)' : ''}`);
    if (link?.linked) {
      void (async () => {
        try {
          const file = await link.putAsset(toBase64(await p.blob.arrayBuffer()));
          if (file !== p.file) {
            await putBlob(file, p.blob).catch(() => undefined);
            rememberUrl(file, p.blob);
            updateImage(img.id, (i) => ({ ...i, file }));
          }
        } catch (e) {
          announce(`The image is on the canvas but was not saved to the project: ${(e as Error).message}`);
        }
      })();
    }
    return img;
  } catch (e) {
    announce((e as Error).message);
    return null;
  }
}

/** Add by URL: fetched into IndexedDB when the server allows it, else shown from the URL. */
export async function addImageUrl(url: string, atRef: Point, section: string | null, link: ClaudeLinkClient | null): Promise<CanvasImage | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    announce('Not a valid image URL');
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'data:') {
    announce('Only http, https and data image URLs are supported');
    return null;
  }
  try {
    const res = await fetch(u, { credentials: 'omit' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) return addImageBlob(blob, atRef, section, link, u.protocol === 'data:' ? undefined : u.pathname.split('/').pop());
    }
  } catch {
    /* CORS or offline: fall back to showing the URL */
  }
  const size = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(canvasSize(img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = u.toString();
  });
  const img = newImage({ url: u.toString(), at: atRef, size, section });
  update((c) => ({ ...c, images: [...c.images, img] }));
  announce('Image added from URL');
  return img;
}

/* ------------------------------ comments ------------------------------ */

export function addComment(input: Parameters<typeof newComment>[0]): Comment {
  const cm = newComment(input);
  update((c) => ({ ...c, comments: [...c.comments, cm] }));
  announce(`Comment added${cm.to === 'claude' ? ' for Claude' : ''}`);
  return cm;
}

function patchComment(id: string, fn: (c: Comment) => Comment) {
  update((c) => ({ ...c, comments: c.comments.map((x) => (x.id === id ? fn(x) : x)) }));
}

export function replyComment(id: string, text: string, forClaude?: boolean) {
  patchComment(id, (c) => ({
    ...c,
    to: forClaude || mentionsClaude(text) ? 'claude' : c.to,
    status: 'open',
    thread: [...c.thread, { author: ME, text, at: new Date().toISOString() }],
  }));
}

export function setCommentStatus(id: string, status: 'open' | 'resolved') {
  patchComment(id, (c) => ({ ...c, status }));
  announce(status === 'resolved' ? 'Comment resolved' : 'Comment reopened');
}

export function setForClaude(id: string, on: boolean) {
  patchComment(id, (c) => ({ ...c, to: on ? 'claude' : null }));
}

export function editMessage(id: string, index: number, text: string) {
  patchComment(id, (c) => ({ ...c, thread: c.thread.map((m, i) => (i === index ? { ...m, text } : m)) }));
}

export function deleteMessage(id: string, index: number) {
  const c = useProject.getState().config.comments.find((x) => x.id === id);
  if (!c) return;
  if (c.thread.length <= 1) return deleteComment(id);
  patchComment(id, (x) => ({ ...x, thread: x.thread.filter((_, i) => i !== index) }));
}

export function deleteComment(id: string) {
  update((c) => ({ ...c, comments: c.comments.filter((x) => x.id !== id) }));
  announce('Comment deleted');
}

export const isClaude = (author: string) => author === CLAUDE;
