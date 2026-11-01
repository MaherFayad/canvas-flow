/**
 * Image on the canvas (feature 9) and its side panel: resize with ratio lock,
 * crop, opacity, caption, "Overlay on frame" (pinned over a frame at 50 %).
 */
import { memo, useEffect, useState } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { frameKey, type CanvasImage, type Device } from '@flowcanvas/config';
import { toRef } from '@/lib/canvas/geometry';
import { OVERLAY_OPACITY, cachedUrl, fromBase64, getBlob, lockRatio, putBlob, rememberUrl } from '@/lib/canvas/images';
import { deleteImage, updateImage } from '@/lib/canvas/boardActions';
import { useProject } from '@/store/project';
import { useBoard } from '@/store/board';
import { useClaude } from '@/store/claude';
import { linkClient } from './ClaudeLink';
import './board.css';

export type ImageNodeData = { image: CanvasImage; overlay: boolean; device: Device };
export type ImageNodeType = Node<ImageNodeData, 'image'>;

/** Object URL for an image: IndexedDB blob, else fetched from the MCP server, else its URL. */
export function useImageSrc(image: Pick<CanvasImage, 'file' | 'url'>): { src: string | null; missing: boolean } {
  const phase = useClaude((s) => s.phase);
  const [src, setSrc] = useState<string | null>(() => (image.file ? (cachedUrl(image.file) ?? null) : (image.url ?? null)));
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    const file = image.file;
    if (!file) {
      setSrc(image.url ?? null);
      return;
    }
    const hit = cachedUrl(file);
    if (hit) {
      setSrc(hit);
      return;
    }
    void (async () => {
      const blob = await getBlob(file).catch(() => undefined);
      if (blob) {
        if (alive) setSrc(rememberUrl(file, blob));
        return;
      }
      const link = linkClient();
      if (link?.linked) {
        try {
          const r = await link.getAsset(file);
          const b = new Blob([fromBase64(r.data) as BlobPart], { type: r.mime });
          await putBlob(file, b).catch(() => undefined);
          if (alive) setSrc(rememberUrl(file, b));
          return;
        } catch {
          /* fall through */
        }
      }
      if (alive) {
        setSrc(image.url ?? null);
        setMissing(!image.url);
      }
    })();
    return () => {
      alive = false;
    };
  }, [image.file, image.url, phase]);
  return { src, missing };
}

function ImageNodeImpl({ data, selected }: NodeProps<ImageNodeType>) {
  const { image, overlay } = data;
  const { src, missing } = useImageSrc(image);
  const free = useBoard((s) => !!s.freeRatio[image.id]);
  const crop = image.crop;
  const opacity = overlay ? (image.overlay?.opacity ?? OVERLAY_OPACITY) : image.opacity;
  const imgStyle = crop
    ? { inlineSize: `${100 / crop.w}%`, blockSize: `${100 / crop.h}%`, insetInlineStart: `${(-crop.x / crop.w) * 100}%`, insetBlockStart: `${(-crop.y / crop.h) * 100}%` }
    : { inlineSize: '100%', blockSize: '100%', inset: 0 };
  return (
    <>
      {!overlay && (
        <NodeResizer
          isVisible={!!selected}
          keepAspectRatio={!free}
          minWidth={40}
          minHeight={40}
          color="#3B82F6"
          onResizeEnd={(_, p) => {
            const at = toRef({ x: p.x, y: p.y }, data.device);
            updateImage(image.id, (i) => ({ ...i, rect: { x: at.x, y: at.y, w: Math.round(p.width), h: Math.round(p.height) } }));
          }}
        />
      )}
      <div className="fc-image" style={{ opacity }}>
        <div className="fc-image-clip">
          {src ? (
            <img src={src} alt={image.caption ?? 'Image'} draggable={false} decoding="async" style={{ ...imgStyle, objectFit: 'fill' }} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fc-muted)', fontSize: 16, border: '1.5px dashed #c4c4c4', borderRadius: 4 }}>
              {missing ? `Image file not found (${image.file})` : 'Loading image…'}
            </div>
          )}
        </div>
        {image.caption && !overlay && <div className="fc-image-caption">{image.caption}</div>}
        {overlay && (
          <div className="fc-image-caption" style={{ insetBlockStart: -28, fontSize: 13 }}>
            Overlay {Math.round(opacity * 100)}%{image.caption ? ` · ${image.caption}` : ''}
          </div>
        )}
      </div>
    </>
  );
}

export const ImageNode = memo(ImageNodeImpl);

/* ------------------------------ panel ------------------------------ */

const pct = (v: number) => Math.round(v * 100);

/** Right panel for the selected image. */
export function ImagePanel({ id }: { id: string }) {
  const image = useProject((s) => s.config.images.find((i) => i.id === id));
  const screens = useProject((s) => s.config.screens);
  const free = useBoard((s) => !!s.freeRatio[id]);
  const [caption, setCaption] = useState(image?.caption ?? '');
  useEffect(() => setCaption(image?.caption ?? ''), [image?.caption]);
  if (!image) return null;
  const crop = image.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const setCrop = (side: 'l' | 't' | 'r' | 'b', v: number) => {
    const c = { ...crop };
    const f = Math.min(0.9, Math.max(0, v / 100));
    if (side === 'l') (c.w = Math.max(0.05, c.x + c.w - f)), (c.x = f);
    if (side === 't') (c.h = Math.max(0.05, c.y + c.h - f)), (c.y = f);
    if (side === 'r') c.w = Math.max(0.05, 1 - f - c.x);
    if (side === 'b') c.h = Math.max(0.05, 1 - f - c.y);
    const full = c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
    updateImage(id, (i) => ({ ...i, crop: full ? null : c }));
  };
  const frames = screens.flatMap((s) => s.states.map((st) => ({ key: frameKey(s.id, st), label: `${s.title} · ${st}` })));
  const row = 'grid items-center gap-2';
  return (
    <aside className="fc-panel" aria-label="Image" style={{ fontSize: 11 }}>
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="mono truncate" style={{ fontSize: 11, fontWeight: 600 }}>
            {image.id}
          </h2>
          <p className="truncate" style={{ color: 'var(--fc-muted)' }}>
            {image.file ?? image.url ?? 'image'}
          </p>
        </div>
        <button className="fc-btn" aria-label="Close image panel" onClick={() => useBoard.getState().set({ panel: null, imageId: null })}>
          ×
        </button>
      </div>
      <section className="grid gap-2 px-3 py-3">
        <span className="fc-label">Caption</span>
        <input
          className="fc-input"
          aria-label="Caption"
          value={caption}
          placeholder="e.g. Figma: Catalog v3"
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (image.caption ?? '') && updateImage(id, (i) => ({ ...i, caption: caption || undefined }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </section>
      <section className="grid gap-2 px-3 py-3">
        <span className="fc-label">Size</span>
        <div className={row} style={{ gridTemplateColumns: '14px 1fr 14px 1fr' }}>
          <label htmlFor="img-w" style={{ color: 'var(--fc-muted)' }}>
            W
          </label>
          <input
            id="img-w"
            type="number"
            min={20}
            className="fc-input tnum"
            value={Math.round(image.rect.w)}
            onChange={(e) => {
              const w = Math.max(20, Number(e.target.value) || 20);
              updateImage(id, (i) => ({ ...i, rect: { ...i.rect, ...(free ? { w } : lockRatio(i.rect, { w, h: i.rect.h })) } }));
            }}
          />
          <label htmlFor="img-h" style={{ color: 'var(--fc-muted)' }}>
            H
          </label>
          <input
            id="img-h"
            type="number"
            min={20}
            className="fc-input tnum"
            value={Math.round(image.rect.h)}
            onChange={(e) => {
              const h = Math.max(20, Number(e.target.value) || 20);
              updateImage(id, (i) => ({ ...i, rect: { ...i.rect, ...(free ? { h } : lockRatio(i.rect, { w: i.rect.w, h })) } }));
            }}
          />
        </div>
        <label className="flex items-center gap-2" style={{ minBlockSize: 24 }}>
          <input type="checkbox" checked={!free} onChange={(e) => useBoard.getState().set({ freeRatio: { ...useBoard.getState().freeRatio, [id]: !e.target.checked } })} />
          Lock aspect ratio
        </label>
      </section>
      <section className="grid gap-2 px-3 py-3">
        <span className="fc-label">Crop (%)</span>
        <div className={row} style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
          {(
            [
              ['l', 'Left', pct(crop.x)],
              ['t', 'Top', pct(crop.y)],
              ['r', 'Right', pct(1 - crop.x - crop.w)],
              ['b', 'Bottom', pct(1 - crop.y - crop.h)],
            ] as const
          ).map(([k, label, v]) => (
            <label key={k} className="contents">
              <span style={{ color: 'var(--fc-muted)' }}>{label}</span>
              <input type="number" min={0} max={90} className="fc-input tnum" value={v} onChange={(e) => setCrop(k, Number(e.target.value) || 0)} />
            </label>
          ))}
        </div>
        {image.crop && (
          <button className="fc-btn justify-self-start" style={{ paddingInline: 0 }} onClick={() => updateImage(id, (i) => ({ ...i, crop: null }))}>
            Reset crop
          </button>
        )}
      </section>
      <section className="grid gap-2 px-3 py-3">
        <label htmlFor="img-op" className="fc-label">
          Opacity
        </label>
        <div className={row} style={{ gridTemplateColumns: '1fr 40px' }}>
          <input
            id="img-op"
            type="range"
            className="fc-range"
            min={0}
            max={100}
            value={pct(image.overlay ? image.overlay.opacity : image.opacity)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              updateImage(id, (i) => (i.overlay ? { ...i, overlay: { ...i.overlay, opacity: v } } : { ...i, opacity: v }));
            }}
          />
          <span className="tnum" style={{ textAlign: 'end' }}>
            {pct(image.overlay ? image.overlay.opacity : image.opacity)}%
          </span>
        </div>
      </section>
      <section className="grid gap-2 px-3 py-3">
        <label htmlFor="img-ov" className="fc-label">
          Overlay on frame
        </label>
        <select
          id="img-ov"
          className="fc-select"
          value={image.overlay?.frame ?? ''}
          onChange={(e) => {
            const f = e.target.value;
            updateImage(id, (i) => ({ ...i, overlay: f ? { frame: f, opacity: i.overlay?.opacity ?? OVERLAY_OPACITY } : null }));
          }}
        >
          <option value="">Not overlaid</option>
          {frames.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <p style={{ color: 'var(--fc-muted)' }}>Pins the image over the frame at 50% to spot gaps between design and build.</p>
      </section>
      <section className="flex justify-end px-3 py-3">
        <button className="fc-btn danger" onClick={() => (deleteImage(id), useBoard.getState().set({ panel: null, imageId: null }))}>
          Delete image
        </button>
      </section>
    </aside>
  );
}
