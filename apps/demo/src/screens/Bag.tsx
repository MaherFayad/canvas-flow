import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { ProductPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { Totals } from '../components/Totals';
import { CrackedBowlIcon, Loading, Notice, PieceName, RetryButton, ScreenTitle, Skeleton, StateView } from '../components/ui';
import { START_BAG, bagResponse, euro, type BagResponse } from '../data';
import { useApi } from '../lib/useApi';

export function Bag() {
  const res = useApi<BagResponse>('/api/bag', {
    empty: { status: 200, body: bagResponse([]) },
    partial: { status: 200, body: bagResponse(START_BAG.map((l) => (l.productId === 'cappuccino-cup-butter' ? { ...l, soldOut: true } : l))) },
  });
  const loaded = res.phase === 'ok' ? res.data : null;
  const [bag, setBag] = useState<BagResponse | null>(null);
  useEffect(() => {
    setBag(loaded);
  }, [loaded]);

  const setQty = (id: string, qty: number) =>
    setBag((b) => (b ? { lines: b.lines.flatMap((l) => (l.productId !== id ? [l] : qty > 0 ? [{ ...l, qty }] : [])) } : b));
  const soldOut = bag?.lines.filter((l) => l.soldOut) ?? [];
  const buyable = bag?.lines.filter((l) => !l.soldOut) ?? [];

  return (
    <Shell>
      <div className="page page-narrow">
        <ScreenTitle title="Bag" />
        {res.phase === 'loading' && (
          <Loading label="Loading your bag">
            <div className="rows">
              {[0, 1, 2].map((i) => (
                <div key={i} className="row">
                  <Skeleton w={64} h={64} r="var(--radius-card)" />
                  <div className="grow stack-xs">
                    <Skeleton h={14} w="60%" />
                    <Skeleton h={12} w="35%" />
                  </div>
                </div>
              ))}
              <Skeleton h={50} r="999px" />
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load your bag" actions={<RetryButton onRetry={res.retry} />}>
            Nothing in it has been lost. Try again in a moment.
          </StateView>
        )}
        {bag && bag.lines.length === 0 && (
          <StateView
            icon={<BagIcon />}
            title="Your bag is empty"
            actions={
              <Link to="/catalog" className="btn btn-outline" {...fc.target('browse-shop')}>
                Browse the shop
              </Link>
            }
          >
            Pieces come in small runs. When one catches your eye, it’s worth keeping it here.
          </StateView>
        )}
        {bag && bag.lines.length > 0 && (
          <div className="bag-layout">
            <div className="stack">
              {soldOut.length > 0 && (
                <Notice tone="danger">
                  <span>
                    <PieceName name={soldOut[0]!.product.name} glaze={soldOut[0]!.product.glaze} /> sold out while it was in your bag. It’s not in your total.
                  </span>
                </Notice>
              )}
              <ul className="rows">
                {bag.lines.map((l) => (
                  <li key={l.productId} className={`row${l.soldOut ? ' is-muted' : ''}`}>
                    <span className="thumb">
                      <ProductPhoto product={l.product} />
                    </span>
                    <div className="grow">
                      <p className="row-title">
                        <PieceName name={l.product.name} glaze={l.product.glaze} />
                      </p>
                      {l.soldOut ? (
                        <button type="button" className="text-link" onClick={() => setQty(l.productId, 0)} {...fc.target(`remove-${l.productId}`)}>
                          Remove
                        </button>
                      ) : (
                        <div className="stepper" role="group" aria-label={`Quantity, ${l.product.name}`}>
                          <button type="button" aria-label="One less" onClick={() => setQty(l.productId, l.qty - 1)}>
                            −
                          </button>
                          <output aria-live="polite">{l.qty}</output>
                          <button type="button" aria-label="One more" onClick={() => setQty(l.productId, l.qty + 1)}>
                            +
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="row-price">{l.soldOut ? 'Sold out' : euro(l.product.price * l.qty)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <aside className="stack">
              <Totals bag={bag} />
              {buyable.length > 0 && (
                <Link to="/checkout" className="btn btn-primary btn-block" {...fc.target('checkout')}>
                  Checkout
                </Link>
              )}
            </aside>
          </div>
        )}
      </div>
    </Shell>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path d="M12 16h24l-2 26H14z M18 16v-3a6 6 0 0 1 12 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
