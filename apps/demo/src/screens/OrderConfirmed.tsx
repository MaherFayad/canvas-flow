import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { ProductPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { CheckIcon, Loading, Notice, RetryButton, Skeleton, StateView } from '../components/ui';
import { euro, latestOrder, type Order } from '../data';
import { useApi } from '../lib/useApi';

export function OrderConfirmed() {
  const res = useApi<Order>('/api/orders/latest', {
    partial: { status: 200, body: { ...latestOrder(), later: { name: 'Cappuccino cup', date: 'Tue, Nov 25' } } },
  });

  return (
    <Shell bare>
      <div className="page page-narrow page-center">
        {res.phase === 'loading' && (
          <Loading label="Loading your order">
            <div className="stack center-items">
              <Skeleton w={56} h={56} r="50%" />
              <Skeleton h={28} w={180} />
              <Skeleton h={14} w="80%" />
              <Skeleton h={14} w="60%" />
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" title="Your order went through" actions={<RetryButton onRetry={res.retry} label="Show my receipt" />}>
            We couldn’t show the receipt just now, but your payment is confirmed and a copy is in your email.
          </StateView>
        )}
        {res.phase === 'ok' && (
          <StateView
            tone="success"
            icon={<CheckIcon size={26} />}
            title="Order placed"
            actions={
              <Link to="/catalog" className="btn btn-primary btn-block" {...fc.target('continue-shopping')}>
                Continue shopping
              </Link>
            }
          >
            <p>
              Order {res.data.id} is confirmed. We’ll send tracking to your email when it ships; expect it by {res.data.eta}.
            </p>
            <div className="thumb-stack" aria-label={res.data.items.map((i) => i.name).join(', ')}>
              {res.data.items.map((it) => (
                <span key={it.id} className="thumb thumb-round">
                  <ProductPhoto product={it} />
                </span>
              ))}
            </div>
            <p className="caption">Paid {euro(res.data.total)}</p>
            {res.data.later && (
              <Notice>
                {res.data.later.name} ships separately on {res.data.later.date}; it’s still cooling in the kiln. No extra delivery charge.
              </Notice>
            )}
          </StateView>
        )}
      </div>
    </Shell>
  );
}
