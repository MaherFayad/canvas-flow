/** Canvas board tools and panels for sections, notes, images and comments (not part of undo history). */
import { create } from 'zustand';
import type { ElementContext } from '@flowcanvas/protocol';
import type { CommentFilter, Probe } from '@/lib/canvas/comments';

export type BoardTool = 'select' | 'section' | 'note' | 'comment';
export type BoardPanel = 'comments' | 'activity' | 'image' | null;

export interface Composer {
  frame: string;
  device: string;
  x: number;
  y: number;
  element: ElementContext | null;
  /** Waiting for the bridge's element-at answer. */
  reading?: boolean;
  /** Screen position for the popover. */
  at: { x: number; y: number };
}

export interface BoardState {
  tool: BoardTool;
  panel: BoardPanel;
  imageId: string | null;
  commentId: string | null;
  commentFilter: CommentFilter;
  composer: Composer | null;
  /** Live selector checks for pins: comment id → probe. */
  probes: Record<string, Probe>;
  /** Image dialog ("Add image by URL"). */
  urlDialog: boolean;
  /** Note being edited (textarea open). */
  editingNote: string | null;
  /** Images whose resize is NOT ratio-locked (locked by default). */
  freeRatio: Record<string, boolean>;
  set(p: Partial<BoardState>): void;
}

export const useBoard = create<BoardState>()((set) => ({
  tool: 'select',
  panel: null,
  imageId: null,
  commentId: null,
  commentFilter: 'open',
  composer: null,
  probes: {},
  urlDialog: false,
  editingNote: null,
  freeRatio: {},
  set: (p) => set(p),
}));
