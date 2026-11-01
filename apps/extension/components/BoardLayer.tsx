/**
 * Canvas-mode layer for sections, sticky notes, images and comment pins
 * (M6). Canvas.tsx calls `useBoardCanvas` for the extra nodes and renders
 * `<BoardOverlays>` (tool strip, section drawing, comment composer,
 * keyboard, drop / paste, pin tracking, camera API for Claude).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useReactFlow, type Node, type NodeChange, type NodeMouseHandler } from '@xyflow/react';
import { frameKey, type Device, type FlowCanvasConfig } from '@flowcanvas/config';
import type { MessageOf } from '@flowcanvas/protocol';
import { HEADER_H, chromeInsets, toRef, toRender } from '@/lib/canvas/geometry';
import type { FrameBox } from '@/lib/canvas/layout';
import { chain, collapsedOwner, descendants, rectToRef, sectionAt, sectionLayout, type BoardLayout, type Box, type SectionView } from '@/lib/canvas/sections';
import { noteBox } from '@/lib/canvas/notes';
import { commentNumber, pinPoint } from '@/lib/canvas/comments';
import { addImageBlob, addImageUrl, addNote, deleteImage, deleteNote, group, moveSectionBy, ungroupSection, updateImage, updateNote } from '@/lib/canvas/boardActions';
import { canvasApi } from '@/lib/canvas/claudeRequests';
import { liveFrame } from '@/lib/canvas/liveFrame';
import { isImageMime } from '@/lib/canvas/images';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useBoard, type BoardTool } from '@/store/board';
import { useClaude } from '@/store/claude';
import { SectionNode, type SectionNodeType } from './SectionNode';
import { NoteNode, noteAriaLabel, type NoteNodeType } from './NoteNode';
import { ImageNode, type ImageNodeType } from './ImageNode';
import { CommentComposer, FlashNode, PinNode, type FlashNodeType, type PinNodeType } from './CommentPin';
import { linkClient } from './ClaudeLink';
import { useHost } from './host';
import './board.css';

export const boardNodeTypes = { section: SectionNode, note: NoteNode, image: ImageNode, pin: PinNode, flash: FlashNode };
export type BoardNode = SectionNodeType | NoteNodeType | ImageNodeType | PinNodeType | FlashNodeType;

const SEC = 'section:';
const PIN = 'pin:';

export const sectionNodeId = (id: string) => `${SEC}${id}`;

interface BoardCanvas {
  board: BoardLayout;
  /** Frames not hidden inside a collapsed section (only these mount). */
  visibleFrames: FrameBox[];
  sectionNodes: SectionNodeType[];
  itemNodes: BoardNode[];
  /** Node id an edge end attaches to (a collapsed section's bar when the frame is hidden). */
  endpoint(screenId: string, key: string): string;
  isLocked(screenId: string): boolean;
  /** Section drag moves its contents live; drops commit notes / images / sections. */
  onNodesChange(changes: NodeChange[], nodes: Node[]): Node[];
  onNodeClick: NodeMouseHandler;
  dropHandlers: { onDragOver(e: DragEvent): void; onDrop(e: DragEvent): void };
  commenting: boolean;
}

function useFrameIndex(frames: FrameBox[]) {
  return useMemo(() => new Map(frames.map((f) => [f.key, f])), [frames]);
}

export function useBoardCanvas(config: FlowCanvasConfig, device: Device, frames: FrameBox[]): BoardCanvas {
  const rf = useReactFlow();
  const host = useHost();
  const tool = useBoard((s) => s.tool);
  const probes = useBoard((s) => s.probes);
  const changed = useClaude((s) => s.changed);
  const byKey = useFrameIndex(frames);
  const ins = chromeInsets(device);

  /* ---------- geometry ---------- */
  const imageBoxes = useMemo(() => {
    const m = new Map<string, Box>();
    for (const i of config.images) {
      if (i.overlay) {
        const f = byKey.get(i.overlay.frame) ?? byKey.get(`${i.overlay.frame}:default`);
        if (f) m.set(i.id, { x: f.x + ins.side, y: f.y + HEADER_H + ins.side + ins.top, w: device.w, h: device.h });
        continue;
      }
      const p = toRender(i.rect, device);
      m.set(i.id, { x: p.x, y: p.y, w: i.rect.w, h: i.rect.h });
    }
    return m;
  }, [config.images, byKey, device, ins.side, ins.top]);
  const noteBoxes = useMemo(() => new Map(config.notes.map((n) => [n.id, noteBox(n, device, byKey, imageBoxes)])), [config.notes, device, byKey, imageBoxes]);
  const board = useMemo(() => sectionLayout(config, device, frames, { images: imageBoxes, notes: noteBoxes }), [config, device, frames, imageBoxes, noteBoxes]);
  const visibleFrames = useMemo(() => frames.filter((f) => !board.hiddenScreens.has(f.screenId)), [frames, board]);
  const visibleKeys = useMemo(() => new Set(visibleFrames.map((f) => f.key)), [visibleFrames]);
  const lockedSections = useMemo(() => new Set(config.sections.filter((s) => s.locked).map((s) => s.id)), [config.sections]);
  const lockedChain = useCallback((sec: string | null | undefined) => chain(config, sec).some((s) => lockedSections.has(s)), [config, lockedSections]);

  /* ---------- nodes ---------- */
  const sectionNodes = useMemo<SectionNodeType[]>(
    () =>
      board.sections
        .filter((v) => !v.hidden)
        .map((v) => ({
          id: sectionNodeId(v.id),
          type: 'section' as const,
          position: { x: v.x, y: v.y },
          width: v.w,
          height: v.h,
          data: { view: v },
          dragHandle: '.fc-sec-drag',
          draggable: !lockedChain(v.id),
          selectable: true,
          // Far below frames even when selected (React Flow lifts selected nodes by 1000).
          zIndex: -2000 + v.depth,
          ariaLabel: `Section ${v.title}`,
        })),
    [board, lockedChain],
  );

  const pins = useMemo(() => {
    const out: Array<{ id: string; x: number; y: number; stale: boolean }> = [];
    for (const cm of config.comments) {
      const f = byKey.get(cm.anchor.frame);
      if (!f || !visibleKeys.has(f.key)) continue;
      const p = pinPoint(cm.anchor, device, probes[cm.id]);
      out.push({ id: cm.id, x: f.x + ins.side + p.x, y: f.y + HEADER_H + ins.side + ins.top + p.y, stale: p.stale });
    }
    return out;
  }, [config.comments, byKey, visibleKeys, device, probes, ins.side, ins.top]);

  const itemNodes = useMemo<BoardNode[]>(() => {
    const title = new Map(config.screens.map((s) => [s.id, s.title]));
    const out: BoardNode[] = [];
    for (const i of config.images) {
      const b = imageBoxes.get(i.id);
      if (!b || board.hiddenImages.has(i.id)) continue;
      const overlay = !!i.overlay;
      out.push({
        id: i.id,
        type: 'image',
        position: { x: b.x, y: b.y },
        width: b.w,
        height: b.h,
        data: { image: i, overlay, device },
        draggable: !overlay && !lockedChain(i.section),
        // Overlays and pins stay above frames even when a frame is selected (+1000 lift).
        zIndex: overlay ? 1500 : 1,
        ariaLabel: `Image${i.caption ? `: ${i.caption}` : ''}${overlay ? `, overlaid on ${i.overlay!.frame}` : ''}`,
      });
    }
    const targets = new Map<string, string>();
    const label = (a: NonNullable<FlowCanvasConfig['notes'][number]['attachTo']>) => {
      const k = `${a.type}|${a.id}`;
      if (!targets.has(k)) {
        let t = a.id;
        if (a.type === 'frame') {
          const [s, st] = a.id.split(':');
          t = `${title.get(s!) ?? s}${st ? ` · ${st}` : ''}`;
        } else if (a.type === 'section') t = config.sections.find((s) => s.id === a.id)?.title ?? a.id;
        else if (a.type === 'image') t = config.images.find((s) => s.id === a.id)?.caption ?? 'image';
        else if (a.type === 'edge') {
          const e = config.edges.find((x) => x.id === a.id);
          t = e?.trigger.label ? `edge “${e.trigger.label}”` : `edge ${a.id}`;
        }
        targets.set(k, t);
      }
      return targets.get(k)!;
    };
    for (const n of config.notes) {
      const b = noteBoxes.get(n.id);
      if (!b || board.hiddenNotes.has(n.id)) continue;
      out.push({
        id: n.id,
        type: 'note',
        position: { x: b.x, y: b.y },
        width: b.w,
        height: b.h,
        data: { note: n, attachedLabel: n.attachTo ? label(n.attachTo) : null, device },
        dragHandle: '.fc-note-head',
        draggable: !lockedChain(n.section),
        zIndex: 20,
        ariaLabel: noteAriaLabel(n),
      });
    }
    for (const p of pins) {
      const cm = config.comments.find((c) => c.id === p.id)!;
      const [s, st] = cm.anchor.frame.split(':');
      out.push({
        id: `${PIN}${p.id}`,
        type: 'pin',
        position: { x: p.x, y: p.y },
        data: { comment: cm, n: commentNumber(config, cm.id), stale: p.stale, frameLabel: `${title.get(s!) ?? s} · ${st}` },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 2000,
      });
    }
    // "Changed by Claude" for 3 s on each changed item.
    const now = Date.now();
    for (const [id, until] of Object.entries(changed)) {
      if (until < now) continue;
      let at: { x: number; y: number } | null = null;
      const head = visibleFrames.find((f) => f.screenId === id && f.stateIndex === 0);
      if (head) at = { x: head.x, y: head.y - 6 };
      const edge = !at && config.edges.find((e) => e.id === id);
      if (edge) {
        const a = byKey.get(frameKey(edge.from.screen, edge.from.state));
        const b = byKey.get(frameKey(edge.to.screen, edge.to.state));
        if (a && b) at = { x: (a.x + a.w + b.x) / 2 - 60, y: (a.y + b.y + a.h) / 2 - 40 };
      }
      const sec = !at && board.sections.find((s) => s.id === id && !s.hidden);
      if (sec) at = { x: sec.x, y: sec.y - 6 };
      const box = !at && (noteBoxes.get(id) ?? imageBoxes.get(id));
      if (box) at = { x: box.x, y: box.y - 6 };
      const pin = !at && pins.find((p) => p.id === id);
      if (pin) at = { x: pin.x + 14, y: pin.y - 14 };
      if (at) out.push({ id: `flash:${id}`, type: 'flash', position: at, data: { label: 'Changed by Claude' }, draggable: false, selectable: false, focusable: false, zIndex: 2100 });
    }
    return out;
  }, [config, imageBoxes, noteBoxes, board, pins, changed, visibleFrames, byKey, lockedChain, device]);

  /* ---------- section drag: contents follow live ---------- */
  const members = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of board.sections) {
      const inside = descendants(config, v.id);
      const ids: string[] = [];
      for (const f of visibleFrames) {
        const s = config.screens.find((x) => x.id === f.screenId);
        if (s?.section && inside.has(s.section)) ids.push(f.key);
      }
      const keys = new Set(ids);
      for (const i of config.images) if ((i.section && inside.has(i.section)) || (i.overlay && keys.has(i.overlay.frame))) ids.push(i.id);
      for (const n of config.notes) if ((n.section && inside.has(n.section)) || (n.attachTo?.type === 'section' && inside.has(n.attachTo.id))) ids.push(n.id);
      for (const s of inside) if (s !== v.id) ids.push(sectionNodeId(s));
      for (const cm of config.comments) if (keys.has(cm.anchor.frame)) ids.push(`${PIN}${cm.id}`);
      m.set(sectionNodeId(v.id), ids);
    }
    return m;
  }, [board, config, visibleFrames]);
  const base = useRef(new Map<string, { x: number; y: number }>());
  const nodesChange = useCallback(
    (changes: NodeChange[], nodes: Node[]): Node[] => {
      let out = nodes;
      for (const ch of changes) {
        if (ch.type === 'select' && ch.selected && nodes.find((x) => x.id === ch.id)?.type === 'image') {
          useBoard.getState().set({ panel: 'image', imageId: ch.id });
        }
        if (ch.type !== 'position' || !ch.position) continue;
        const n = nodes.find((x) => x.id === ch.id);
        if (!n) continue;
        if (n.type === 'section') {
          if (!base.current.has(ch.id)) {
            // Positions at drag start (section + members).
            const snap = new Map<string, { x: number; y: number }>();
            for (const id of [ch.id, ...(members.get(ch.id) ?? [])]) {
              const m = nodes.find((x) => x.id === id);
              if (m) snap.set(id, id === ch.id ? sectionNodes.find((s) => s.id === id)?.position ?? m.position : m.position);
            }
            base.current = snap;
          }
          const start = base.current.get(ch.id)!;
          const d = { x: ch.position.x - start.x, y: ch.position.y - start.y };
          const ids = new Set(members.get(ch.id) ?? []);
          out = out.map((m) => (ids.has(m.id) && base.current.has(m.id) ? { ...m, position: { x: base.current.get(m.id)!.x + d.x, y: base.current.get(m.id)!.y + d.y } } : m));
          if (ch.dragging === false) {
            base.current = new Map();
            moveSectionBy((n.data as { view: SectionView }).view.id, d, device);
          }
        } else if (ch.dragging === false && (n.type === 'note' || n.type === 'image')) {
          const r = toRef(ch.position, device);
          const center = { x: ch.position.x + (n.width ?? 200) / 2, y: ch.position.y + (n.height ?? 100) / 2 };
          const sec = sectionAt(board, center);
          if (n.type === 'note') updateNote(n.id, (x) => ({ ...x, rect: { ...x.rect, x: r.x, y: r.y }, section: sec }));
          else updateImage(n.id, (x) => ({ ...x, rect: { ...x.rect, x: r.x, y: r.y }, section: sec }));
        }
      }
      return out;
    },
    [members, sectionNodes, device, board],
  );

  /* ---------- comment mode: click a frame to drop a pin ---------- */
  const onNodeClick = useCallback<NodeMouseHandler>(
    (e, node) => {
      if (useBoard.getState().tool !== 'comment' || node.type !== 'frame') return;
      const f = byKey.get(node.id);
      if (!f) return;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const local = { x: p.x - f.x - ins.side, y: p.y - f.y - HEADER_H - ins.side - ins.top };
      if (local.x < 0 || local.y < 0 || local.x > device.w || local.y > device.h) return;
      const pane = (e.currentTarget as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      const at = { x: e.clientX - (pane?.left ?? 0), y: e.clientY - (pane?.top ?? 0) };
      const base = { frame: f.key, device: device.id, x: local.x / device.w, y: local.y / device.h, at };
      useBoard.getState().set({ composer: { ...base, element: null, reading: true } });
      void (async () => {
        let element = null;
        if (host) {
          const lf = await liveFrame(host, f.screenId, f.state, 6000);
          if (lf) {
            const r = await host.request<MessageOf<'element-result'>>(lf.frameId, { fc: 'element-at', id: '', x: local.x, y: local.y }, 3000);
            element = r?.element ?? null;
          }
        }
        const cur = useBoard.getState().composer;
        if (cur && cur.frame === base.frame && cur.x === base.x && cur.y === base.y) useBoard.getState().set({ composer: { ...cur, element, reading: false } });
      })();
    },
    [byKey, rf, device, host, ins.side, ins.top],
  );

  /* ---------- drop images ---------- */
  const dropHandlers = useMemo(
    () => ({
      onDragOver(e: DragEvent) {
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')) e.preventDefault();
      },
      onDrop(e: DragEvent) {
        const files = [...e.dataTransfer.files].filter((f) => isImageMime(f.type));
        const url = e.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim();
        if (!files.length && !url) return;
        e.preventDefault();
        e.stopPropagation();
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const sec = sectionAt(board, p);
        const at = toRef(p, device);
        if (files.length) files.forEach((f, i) => void addImageBlob(f, { x: at.x + i * 40, y: at.y + i * 40 }, sec, linkClient()));
        else if (url) void addImageUrl(url, at, sec, linkClient());
      },
    }),
    [rf, board, device],
  );

  return useMemo<BoardCanvas>(
    () => ({
      board,
      visibleFrames,
      sectionNodes,
      itemNodes,
      endpoint: (screenId, key) => {
        const s = config.screens.find((x) => x.id === screenId);
        const owner = collapsedOwner(config, s?.section);
        return owner ? sectionNodeId(owner) : key;
      },
      isLocked: (screenId) => lockedChain(config.screens.find((x) => x.id === screenId)?.section),
      onNodesChange: nodesChange,
      onNodeClick,
      dropHandlers,
      commenting: tool === 'comment',
    }),
    [board, visibleFrames, sectionNodes, itemNodes, config, lockedChain, nodesChange, onNodeClick, dropHandlers, tool],
  );
}

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

const TOOLS: Array<{ id: BoardTool | 'image'; label: string; key: string; hint: string }> = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Select and move (V)' },
  { id: 'section', label: 'Section', key: 'S', hint: 'Draw a section (S). Cmd/Ctrl+G groups the selection.' },
  { id: 'note', label: 'Note', key: 'N', hint: 'Add a sticky note (N)' },
  { id: 'comment', label: 'Comment', key: 'C', hint: 'Click a spot on a frame to comment (C)' },
  { id: 'image', label: 'Image', key: 'I', hint: 'Add an image from a file or URL (I). You can also drop or paste images.' },
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

interface OverlayProps {
  config: FlowCanvasConfig;
  device: Device;
  board: BoardLayout;
  visibleFrames: FrameBox[];
}

export function BoardOverlays({ config, device, board, visibleFrames }: OverlayProps) {
  const rf = useReactFlow();
  const host = useHost();
  const tool = useBoard((s) => s.tool);
  const [imageMenu, setImageMenu] = useState(false);
  const live = useRef({ config, board, device, visibleFrames });
  live.current = { config, board, device, visibleFrames };

  const viewCenter = useCallback(() => {
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 });
  }, [rf]);

  const newNoteAtCenter = useCallback(() => {
    const c = viewCenter();
    const { board, device } = live.current;
    const n = addNote(toRef({ x: c.x - 110, y: c.y - 60 }, device), sectionAt(board, c));
    useBoard.getState().set({ editingNote: n.id, tool: 'select' });
  }, [viewCenter]);

  const setTool = useCallback(
    (t: BoardTool | 'image') => {
      if (t === 'note') return newNoteAtCenter();
      if (t === 'image') return setImageMenu((o) => !o);
      useBoard.getState().set({ tool: useBoard.getState().tool === t && t !== 'select' ? 'select' : t, composer: null });
      if (t === 'comment') rf.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      const msg: Record<BoardTool, string> = {
        select: 'Select tool',
        section: 'Section tool: drag on the canvas to draw a section. Escape to cancel.',
        note: '',
        comment: 'Comment mode: click a spot on a frame. Escape to leave.',
      };
      useUi.getState().set({ announce: msg[t] });
    },
    [newNoteAtCenter, rf],
  );

  const selection = useCallback(() => {
    const sel = { screens: [] as string[], images: [] as string[], notes: [] as string[], sections: [] as string[] };
    for (const n of rf.getNodes()) {
      if (!n.selected) continue;
      if (n.type === 'frame') sel.screens.push((n.data as { screen: { id: string } }).screen.id);
      else if (n.type === 'note') sel.notes.push(n.id);
      else if (n.type === 'image') sel.images.push(n.id);
      else if (n.type === 'section') sel.sections.push((n.data as { view: SectionView }).view.id);
    }
    sel.screens = [...new Set(sel.screens)];
    return sel;
  }, [rf]);

  /* Keyboard: V S N C I, Cmd/Ctrl+G, Cmd/Ctrl+Shift+G, Delete, Escape. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || useUi.getState().mode !== 'canvas') return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'g') {
        e.preventDefault();
        const sel = selection();
        if (e.shiftKey) {
          if (!sel.sections.length) useUi.getState().set({ announce: 'Select a section to ungroup' });
          sel.sections.forEach((s) => ungroupSection(s));
        } else group(sel);
        return;
      }
      if (mod || e.altKey) return;
      if (k === 'escape') {
        if (useBoard.getState().tool !== 'select' || useBoard.getState().composer) useBoard.getState().set({ tool: 'select', composer: null });
        setImageMenu(false);
        return;
      }
      if ((k === 'delete' || k === 'backspace') && !(document.activeElement as HTMLElement | null)?.classList.contains('react-flow__node-note')) {
        const sel = selection();
        if (sel.images.length) {
          e.preventDefault();
          sel.images.forEach((id) => deleteImage(id));
        }
        sel.notes.forEach((id) => deleteNote(id));
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) {
        e.preventDefault();
        setTool(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, setTool]);

  /* Paste images (files or an image URL). */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || useUi.getState().mode !== 'canvas') return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => isImageMime(f.type));
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
      const c = viewCenter();
      const { board, device } = live.current;
      const at = toRef({ x: c.x - 200, y: c.y - 150 }, device);
      if (files.length) {
        e.preventDefault();
        files.forEach((f) => void addImageBlob(f, at, sectionAt(board, c), linkClient()));
      } else if (/^(https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?|data:image\/[a-z+]+;base64,\S+)$/i.test(text)) {
        e.preventDefault();
        void addImageUrl(text, at, sectionAt(board, c), linkClient());
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [viewCenter]);

  /* Pins follow their selector: re-check live frames every 1.5 s. */
  useEffect(() => {
    if (!host) return;
    let stop = false;
    const tick = async () => {
      const { config } = live.current;
      const next: Record<string, { found: boolean; rect: { x: number; y: number; w: number; h: number } | null }> = {};
      for (const cm of config.comments) {
        if (!cm.anchor.element) continue;
        const [s, st = 'default'] = cm.anchor.frame.split(':');
        const f = host.framesFor(s!, st).find((x) => x.nonce && x.ready);
        if (!f) continue;
        const r = await host.request<MessageOf<'query-result'>>(f.frameId, { fc: 'query', id: '', selector: cm.anchor.element.selector }, 2000);
        if (r) next[cm.id] = { found: r.found, rect: r.rect };
      }
      if (!stop && JSON.stringify(next) !== JSON.stringify(useBoard.getState().probes)) useBoard.getState().set({ probes: next });
    };
    const t = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [host]);

  /* Camera + selection for Claude (focus, get_selection). */
  useEffect(() => {
    canvasApi.focus = (itemId) => {
      const { config, visibleFrames } = live.current;
      const nodes = new Set(rf.getNodes().map((n) => n.id));
      let ids: string[] = [];
      const screen = config.screens.find((s) => s.id === itemId);
      const edge = config.edges.find((e) => e.id === itemId);
      const cm = config.comments.find((c) => c.id === itemId);
      const owner = (sid: string) => collapsedOwner(config, config.screens.find((s) => s.id === sid)?.section);
      const frameNode = (key: string) => {
        const sid = key.split(':')[0]!;
        const o = owner(sid);
        return o ? sectionNodeId(o) : key.includes(':') ? key : (visibleFrames.find((f) => f.screenId === sid)?.key ?? key);
      };
      if (screen) ids = [frameNode(`${screen.id}:${screen.states[0] ?? 'default'}`)];
      else if (itemId.includes(':') && nodes.has(itemId)) ids = [itemId];
      else if (itemId.includes(':')) ids = [frameNode(itemId)];
      else if (edge) ids = [frameNode(frameKey(edge.from.screen, edge.from.state)), frameNode(frameKey(edge.to.screen, edge.to.state))];
      else if (cm) ids = [`${PIN}${cm.id}`, frameNode(cm.anchor.frame)];
      else if (config.sections.some((s) => s.id === itemId)) ids = [sectionNodeId(itemId)];
      else ids = [itemId];
      ids = ids.filter((i) => nodes.has(i));
      if (!ids.length) return false;
      void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, maxZoom: 0.8, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 });
      if (edge) useUi.getState().set({ selectedEdge: edge.id });
      if (cm) useBoard.getState().set({ panel: 'comments', commentId: cm.id });
      return true;
    };
    canvasApi.selection = () => {
      const items: Array<{ id: string; type: string }> = [];
      for (const n of rf.getNodes()) {
        if (!n.selected) continue;
        if (n.type === 'frame') items.push({ id: n.id, type: 'frame' });
        else if (n.type === 'section') items.push({ id: (n.data as { view: SectionView }).view.id, type: 'section' });
        else if (n.type === 'note' || n.type === 'image') items.push({ id: n.id, type: n.type });
      }
      const e = useUi.getState().selectedEdge;
      if (e) items.push({ id: e, type: 'edge' });
      const c = useBoard.getState().commentId;
      if (c && useBoard.getState().panel === 'comments') items.push({ id: c, type: 'comment' });
      return { ids: items.map((i) => i.id), items };
    };
    return () => {
      canvasApi.focus = null;
      canvasApi.selection = null;
    };
  }, [rf]);

  return (
    <>
      <div className="fc-tools" role="toolbar" aria-label="Canvas tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="fc-btn"
            aria-pressed={t.id === 'image' ? imageMenu : t.id === 'note' ? false : tool === t.id}
            aria-keyshortcuts={t.key}
            title={t.hint}
            onClick={() => setTool(t.id)}
          >
            {t.label} <kbd aria-hidden>{t.key}</kbd>
          </button>
        ))}
      </div>
      {imageMenu && <ImageMenu live={live} onClose={() => setImageMenu(false)} center={viewCenter} />}
      {tool === 'section' && <SectionDraw live={live} />}
      <CommentComposer />
    </>
  );
}

type LiveRef = { current: OverlayProps };

function ImageMenu({ onClose, center, live }: { onClose: () => void; center: () => { x: number; y: number }; live: LiveRef }) {
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const add = (fn: (at: { x: number; y: number }, sec: string | null) => void) => {
    const c = center();
    const { board, device } = live.current;
    fn(toRef({ x: c.x - 200, y: c.y - 150 }, device), sectionAt(board, c));
    onClose();
  };
  return (
    <div
      className="fc-popover"
      role="dialog"
      aria-label="Add image"
      style={{ insetBlockStart: 48, insetInlineStart: 12 }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="grid gap-2">
        <button className="fc-btn primary justify-self-start" autoFocus onClick={() => fileRef.current?.click()}>
          Choose image file…
        </button>
        <input
          ref={fileRef}
          type="file"
          aria-label="Image file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) add((at, sec) => void addImageBlob(f, at, sec, linkClient()));
          }}
        />
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add((at, sec) => void addImageUrl(url.trim(), at, sec, linkClient()));
          }}
        >
          <label className="sr-only" htmlFor="fc-img-url">
            Image URL
          </label>
          <input id="fc-img-url" className="fc-input min-w-0 flex-1" placeholder="https://…/screen.png" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="fc-btn" type="submit" disabled={!url.trim()}>
            Add
          </button>
        </form>
        <p style={{ color: 'var(--fc-muted)' }}>Or drop / paste an image on the canvas.</p>
      </div>
    </div>
  );
}

function SectionDraw({ live }: { live: LiveRef }) {
  const rf = useReactFlow();
  const [r, setR] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const local = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const draw = (box: Box) => {
    const { config, board, device, visibleFrames } = live.current;
    const nodes = rf.getNodes();
    const inside = (b: Box) => {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
    };
    const nodeInside = (id: string) => nodes.some((x) => x.id === id && inside({ ...x.position, w: x.width ?? x.measured?.width ?? 0, h: x.height ?? x.measured?.height ?? 0 }));
    const contains = (b: Box) => b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
    const screens = [...new Set(visibleFrames.filter((f) => f.stateIndex === 0 && inside(f)).map((f) => f.screenId))];
    const notes = config.notes.filter((n) => nodeInside(n.id)).map((n) => n.id);
    const images = config.images.filter((i) => !i.overlay && nodeInside(i.id)).map((i) => i.id);
    const sections = board.sections.filter((s) => !s.hidden && contains(s)).map((s) => s.id);
    const count = screens.length + notes.length + images.length + sections.length;
    const parent = count ? undefined : sectionAt(board, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    const id = group({ screens, notes, images, sections }, { rect: rectToRef(box, device), ...(parent !== undefined ? { parent } : {}) });
    useBoard.getState().set({ tool: 'select' });
    if (id) useUi.getState().set({ announce: `Section drawn with ${count} items. Double-click its name to rename.` });
  };
  return (
    <div
      ref={ref}
      className="fc-draw"
      role="presentation"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = local(e);
        setR({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!r) return;
        const p = local(e);
        setR({ ...r, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!r) return;
        setR(null);
        if (Math.abs(r.x1 - r.x0) < 24 || Math.abs(r.y1 - r.y0) < 24) return;
        const b = ref.current!.getBoundingClientRect();
        const a = rf.screenToFlowPosition({ x: b.left + Math.min(r.x0, r.x1), y: b.top + Math.min(r.y0, r.y1) });
        const z = rf.screenToFlowPosition({ x: b.left + Math.max(r.x0, r.x1), y: b.top + Math.max(r.y0, r.y1) });
        draw({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y });
      }}
    >
      {r && (
        <div
          className="fc-draw-rect"
          style={{ insetInlineStart: Math.min(r.x0, r.x1), insetBlockStart: Math.min(r.y0, r.y1), inlineSize: Math.abs(r.x1 - r.x0), blockSize: Math.abs(r.y1 - r.y0) }}
        />
      )}
    </div>
  );
}
