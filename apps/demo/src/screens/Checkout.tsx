import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { Shell } from '../components/Shell';
import { Totals } from '../components/Totals';
import { CrackedBowlIcon, Loading, Notice, RetryButton, ScreenTitle, Skeleton, Spinner, StateView } from '../components/ui';
import { ADDRESS, START_BAG, bagResponse, bagTotal, euro, type Address, type BagResponse } from '../data';
import { postJson, useApi, useFormStatus, type Fixture } from '../lib/useApi';

const BAG: Fixture = { status: 200, body: bagResponse(START_BAG) };
const ADDR: Fixture = { status: 200, body: ADDRESS };

export function Checkout() {
  const navigate = useNavigate();
  // Forced loading / error are about the payment, so the form data still loads.
  const bag = useApi<BagResponse>('/api/bag', { loading: BAG, error: BAG, empty: BAG });
  const addr = useApi<Address>('/api/address', { loading: ADDR, error: ADDR, empty: { status: 200, body: { name: '', street: '', city: '' } } });
  const [status, setStatus] = useFormStatus();
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [card, setCard] = useState(status === 'error' ? '4000 0000 0000 0002' : '4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('08 / 28');
  const [cvc, setCvc] = useState('123');
  const loadedAddr = addr.phase === 'ok' ? addr.data : null;
  useEffect(() => {
    if (!loadedAddr) return;
    setName(loadedAddr.name);
    setStreet(loadedAddr.street ? `${loadedAddr.street}, ${loadedAddr.city}` : '');
  }, [loadedAddr]);
  const busy = status === 'loading';

  async function pay(e: FormEvent) {
    e.preventDefault();
    setStatus('loading');
    const r = await postJson('/api/orders', { card, name, street });
    if (r.status === 201) navigate('/order-confirmed');
    else setStatus('error');
  }

  const loading = bag.phase === 'loading' || addr.phase === 'loading';
  const failed = bag.phase === 'error' ? bag : addr.phase === 'error' ? addr : null;

  return (
    <Shell bare>
      <div className="page page-narrow">
        <ScreenTitle back={{ to: '/bag', label: 'Back to bag', fc: 'back-to-bag' }} title="Checkout" />
        {loading && (
          <Loading label="Loading checkout">
            <div className="stack">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="stack-xs">
                  <Skeleton h={11} w={90} />
                  <Skeleton h={46} r="var(--radius-field)" />
                </div>
              ))}
            </div>
          </Loading>
        )}
        {!loading && failed && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load checkout" actions={<RetryButton onRetry={failed.retry} />}>
            You haven’t been charged. Try again in a moment.
          </StateView>
        )}
        {bag.phase === 'ok' && addr.phase === 'ok' && (
          <form className="stack" onSubmit={pay} noValidate>
            {status === 'error' && (
              <Notice tone="danger">
                <span>
                  <strong>Your card was declined.</strong> Nothing was charged. Try another card or check the details with your bank.
                </span>
              </Notice>
            )}
            <fieldset className="form-section" disabled={busy}>
              <legend className="section-label">Delivery</legend>
              {!addr.data.street && <p className="caption muted">Where should we send it? We deliver across Germany and the EU.</p>}
              <div className="field">
                <label htmlFor="co-name">Full name</label>
                <input id="co-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Lindqvist" />
              </div>
              <div className="field">
                <label htmlFor="co-address">Address</label>
                <input id="co-address" autoComplete="street-address" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street, number, postcode, city" />
              </div>
            </fieldset>
            <fieldset className="form-section" disabled={busy}>
              <legend className="section-label">Payment</legend>
              <div className={`field${status === 'error' ? ' has-error' : ''}`}>
                <label htmlFor="co-card">Card number</label>
                <input
                  id="co-card"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  value={card}
                  onChange={(e) => setCard(e.target.value)}
                  aria-invalid={status === 'error' || undefined}
                  aria-describedby={status === 'error' ? 'co-card-err' : 'co-card-hint'}
                />
                {status === 'error' && (
                  <p className="field-error" id="co-card-err">
                    Declined by your bank.
                  </p>
                )}
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="co-exp">Expiry</label>
                  <input id="co-exp" autoComplete="cc-exp" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="co-cvc">CVC</label>
                  <input id="co-cvc" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} />
                </div>
              </div>
              <p className="caption muted" id="co-card-hint">
                Use 4242 4242 4242 4242 for a test payment. Card details are encrypted and never stored.
              </p>
            </fieldset>
            <Totals bag={bag.data} />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy} {...fc.target('pay')}>
              {busy ? (
                <>
                  <Spinner /> Processing…
                </>
              ) : (
                `Pay ${euro(bagTotal(bag.data))}`
              )}
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}
