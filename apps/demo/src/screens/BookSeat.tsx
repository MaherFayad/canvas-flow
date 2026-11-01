import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { Shell } from '../components/Shell';
import { CrackedBowlIcon, Loading, Notice, RetryButton, ScreenTitle, Skeleton, Spinner, StateView } from '../components/ui';
import { CLASSES, classById, euro, type PotteryClass } from '../data';
import { postJson, useApi, useFormStatus, type Fixture } from '../lib/useApi';

export function BookSeat() {
  const { id = 'tableware-course' } = useParams();
  const navigate = useNavigate();
  const sample: Fixture = { status: 200, body: classById(id) ?? CLASSES[0] };
  // Forced loading / error are about the booking, so the class still loads.
  const res = useApi<PotteryClass>(`/api/classes/${id}`, { loading: sample, error: sample });
  const [status, setStatus] = useFormStatus();
  const [name, setName] = useState('Maya Lindqvist');
  const [email, setEmail] = useState('maya@example.com');
  const [seats, setSeats] = useState<1 | 2>(1);
  const busy = status === 'loading';

  async function book(e: FormEvent) {
    e.preventDefault();
    if (res.phase !== 'ok') return;
    setStatus('loading');
    const r = await postJson('/api/bookings', { classId: id, date: res.data.next, seats, name, email });
    if (r.status === 201) navigate(`/classes/${id}/booked`);
    else setStatus('error');
  }

  return (
    <Shell bare>
      <div className="page page-narrow">
        <ScreenTitle back={{ to: `/classes/${id}`, label: 'Back to the class', fc: 'back-to-class' }} title="Book a seat" />
        {res.phase === 'loading' && (
          <Loading label="Loading">
            <div className="stack">
              <Skeleton h={64} r="var(--radius-card)" />
              <Skeleton h={46} r="var(--radius-field)" />
              <Skeleton h={46} r="var(--radius-field)" />
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load this class" actions={<RetryButton onRetry={res.retry} />}>
            Try again in a moment.
          </StateView>
        )}
        {res.phase === 'ok' && (
          <form className="stack" onSubmit={book} noValidate>
            <div className="summary-card">
              <p className="row-title-lg">{res.data.title}</p>
              <p className="caption muted">
                Starts {res.data.next} · {res.data.weeks}
              </p>
            </div>
            {status === 'error' && (
              <Notice tone="danger">
                <span>
                  <strong>The course filled up while you were booking.</strong> You haven’t been charged. Join the waitlist or pick another class.
                </span>
              </Notice>
            )}
            <fieldset className="form-section" disabled={busy}>
              <div className="field">
                <label htmlFor="bk-name">Name</label>
                <input id="bk-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bk-email">Email</label>
                <input id="bk-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <span className="label" id="bk-seats">
                  Seats
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="bk-seats">
                  {([1, 2] as const).map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={seats === n} className={`chip chip-lg${seats === n ? ' is-on' : ''}`} onClick={() => setSeats(n)} {...fc.target(`seats-${n}`)}>
                      {n === 1 ? 'Just me' : 'Me + 1'}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
            <dl className="totals">
              <div className="total">
                <dt>Total</dt>
                <dd>{euro(res.data.price * seats)}</dd>
              </div>
            </dl>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy} {...fc.target('confirm-booking')}>
              {busy ? (
                <>
                  <Spinner /> Booking…
                </>
              ) : (
                'Confirm booking'
              )}
            </button>
            <p className="caption muted center">You pay at the studio on the first evening. Free cancellation up to 7 days before.</p>
          </form>
        )}
      </div>
    </Shell>
  );
}
