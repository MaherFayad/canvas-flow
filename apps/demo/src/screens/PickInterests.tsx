import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { useFcState } from '@flowcanvas/sdk/react';
import { Shell } from '../components/Shell';
import { CrackedBowlIcon, Loading, RetryButton, ScreenTitle, Skeleton, StateView } from '../components/ui';
import type { Interest } from '../data';
import { useApi } from '../lib/useApi';

export function PickInterests() {
  const navigate = useNavigate();
  const forced = useFcState();
  const res = useApi<{ items: Interest[] }>('/api/interests');
  // "partial" is the missing-answer state: nothing picked yet, Continue is off.
  const preset = forced === 'partial' ? [] : ['cups', 'classes'];
  const [picked, setPicked] = useState<string[]>(preset);
  useEffect(() => {
    setPicked(preset);
  }, [forced]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const canGo = res.phase === 'ok' && picked.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canGo) navigate('/catalog');
  }

  return (
    <Shell bare>
      <form className="page page-narrow page-fill" onSubmit={submit}>
        <ScreenTitle back={{ to: '/', label: 'Back', fc: 'back' }} title="What brings you here?" sub="Pick a few; we’ll show you the pieces and classes that fit." />

        {res.phase === 'loading' && (
          <Loading label="Loading interests">
            <div className="chips">
              {[96, 64, 58, 78, 110, 104, 120, 82].map((w, i) => (
                <Skeleton key={i} w={w} h={40} r="999px" />
              ))}
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load this step" actions={<RetryButton onRetry={res.retry} />}>
            Try again, or skip it for now. You can tell us what you like later.
          </StateView>
        )}
        {res.phase === 'ok' && (
          <fieldset className="chips">
            <legend className="sr-only">Interests</legend>
            {res.data.items.map((it) => {
              const on = picked.includes(it.id);
              return (
                <button key={it.id} type="button" className={`chip chip-lg${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(it.id)} {...fc.target(`interest-${it.id}`)}>
                  {it.label}
                </button>
              );
            })}
          </fieldset>
        )}

        <div className="sticky-actions">
          {res.phase === 'ok' && picked.length === 0 && (
            <p className="caption muted center" id="pick-hint">
              Pick at least one to continue.
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={!canGo} aria-describedby={picked.length === 0 ? 'pick-hint' : undefined} {...fc.target('interests-continue')}>
            Continue{picked.length > 0 ? ` · ${picked.length}` : ''}
          </button>
        </div>
      </form>
    </Shell>
  );
}
