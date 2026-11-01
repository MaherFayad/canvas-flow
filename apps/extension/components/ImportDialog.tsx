import { useEffect, useRef, useState } from 'react';
import { parseConfig, type FlowCanvasConfig } from '@flowcanvas/config';

export function parseConfigText(text: string): { ok: true; config: FlowCanvasConfig } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  return parseConfig(raw);
}

export function ImportDialog({ onImport, onClose }: { onImport: (c: FlowCanvasConfig) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const tryImport = (t: string) => {
    const r = parseConfigText(t);
    if (r.ok) onImport(r.config);
    else setErrors(r.errors);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="import-title"
      className="m-auto w-[560px] max-w-[92vw] rounded-xl border border-gray-200 p-0 shadow-2xl backdrop:bg-black/30"
      onClose={onClose}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void f.text().then((t) => (setText(t), tryImport(t)));
      }}
    >
      <form
        method="dialog"
        className="flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          tryImport(text);
        }}
      >
        <h2 id="import-title" className="text-[16px] font-semibold">
          Import flowcanvas.config.json
        </h2>
        <p className="text-[13px] text-gray-600">Paste the JSON, drop the file here, or pick it.</p>
        <textarea
          aria-label="Config JSON"
          className="h-56 w-full rounded-lg border border-gray-300 p-2 font-mono text-[12px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "version": 1, "project": { "name": "…", "origin": "http://localhost:5173" } }'
        />
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Config file"
          className="text-[13px]"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((t) => (setText(t), tryImport(t)));
          }}
        />
        {errors.length > 0 && (
          <div role="alert" className="max-h-32 overflow-auto rounded-lg border border-red-200 bg-red-50 p-2 text-[12px] text-red-800">
            <strong>Config has {errors.length} problem{errors.length > 1 ? 's' : ''}:</strong>
            <ul className="list-disc ps-5">
              {errors.slice(0, 20).map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="fc-btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="fc-btn primary">
            Import
          </button>
        </div>
      </form>
    </dialog>
  );
}
