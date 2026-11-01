import { bagSubtotal, deliveryFor, euro, type BagResponse } from '../data';

export function Totals({ bag }: { bag: BagResponse }) {
  const sub = bagSubtotal(bag);
  const ship = deliveryFor(sub);
  return (
    <dl className="totals">
      <div>
        <dt>Shipping</dt>
        <dd>{ship === 0 ? 'Free' : euro(ship)}</dd>
      </div>
      <div className="total">
        <dt>Total</dt>
        <dd>{euro(sub + ship)}</dd>
      </div>
    </dl>
  );
}
