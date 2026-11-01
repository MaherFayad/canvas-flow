import { useFcReady, useFcState } from '@flowcanvas/sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';

/** A canned response for a forced state, or 'pending' to stay loading. */
export type Fixture = { status: number; body: unknown } | 'pending';
export type Fixtures = Partial<Record<string, Fixture>>;

export type ApiResult<T> =
  | { phase: 'loading' }
  | { phase: 'error'; status: number }
  | { phase: 'ok'; data: T };

const BUILTIN: Fixtures = {
  loading: 'pending',
  error: { status: 500, body: { error: 'server' } },
};

/**
 * GET JSON from the dev API.
 * SDK path: when the canvas forces a state (`?fc-state=` + handshake), answer from
 * local fixtures instead of the network. No SDK: always fetch, so the canvas
 * mock layer can answer instead. Sends `fc.ready()` once the data settles.
 */
export function useApi<T>(url: string, fixtures: Fixtures = {}): ApiResult<T> & { retry: () => void } {
  const forced = useFcState();
  const [res, setRes] = useState<ApiResult<T>>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const fx = useRef(fixtures);
  fx.current = fixtures;

  useEffect(() => {
    let alive = true;
    const settle = (status: number, body: unknown) => {
      if (!alive) return;
      setRes(status >= 200 && status < 300 ? { phase: 'ok', data: body as T } : { phase: 'error', status });
    };
    setRes({ phase: 'loading' });
    const fixture = forced === 'default' ? undefined : fx.current[forced] ?? BUILTIN[forced];
    if (fixture === 'pending') return;
    if (fixture) {
      settle(fixture.status, fixture.body);
    } else {
      fetch(url, { headers: { accept: 'application/json' } })
        .then(async (r) => settle(r.status, await r.json().catch(() => null)))
        .catch(() => settle(0, null));
    }
    return () => {
      alive = false;
    };
  }, [url, forced, attempt]);

  useFcReady(res.phase !== 'loading' || forced === 'loading');
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...res, retry };
}

/** POST JSON; resolves with status and body, never throws. */
export async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

export type FormStatus = 'idle' | 'loading' | 'error' | 'success';

/** Form screens: the forced state picks the form status (loading = submitting). */
export function useFormStatus(): [FormStatus, (s: FormStatus) => void] {
  const forced = useFcState();
  const initial: FormStatus = forced === 'loading' || forced === 'error' || forced === 'success' ? forced : 'idle';
  const [status, setStatus] = useState<FormStatus>(initial);
  useEffect(() => {
    setStatus(initial);
  }, [initial]);
  return [status, setStatus];
}
