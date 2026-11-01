import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { useFcState } from '@flowcanvas/sdk/react';
import { ProductPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { ChevronLeft, CrackedBowlIcon, HeartIcon, Loading, Notice, PieceName, RetryButton, Skeleton, Spinner, StateView } from '../components/ui';
import { euro, productById, type Product as P } from '../data';
import { postJson, useApi } from '../lib/useApi';

export function Product() {
  const { id = 'canele-dinner-plate' } = useParams();
  const navigate = useNavigate();
  const forced = useFcState();
  const sample = productById(id) ?? productById('canele-dinner-plate')!;
  const res = useApi<P & { stockUnknown?: boolean }>(`/api/products/${id}`, {
    saved: { status: 200, body: sample },
    partial: { status: 200, body: { ...sample, stockUnknown: true } },
  });
  const [saved, setSaved] = useState(forced === 'saved');
  const [sheet, setSheet] = useState(forced === 'saved');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    setSaved(forced === 'saved');
    setSheet(forced === 'saved');
  }, [forced]);

  async function save() {
    setSaved(true);
    setSheet(true);
    await postJson('/api/wishlist', { productId: id });
  }
  async function addToBag() {
    setAdding(true);
    await postJson('/api/bag', { productId: id });
    navigate('/bag');
  }

  return (
    <Shell bare>
      <article className="detail">
        <div className="detail-photo">
          {res.phase === 'ok' ? <ProductPhoto product={res.data} /> : <Skeleton h="100%" r="0" />}
          <Link to="/catalog" className="photo-back" aria-label="Back to the collection" {...fc.target('back-to-catalog')}>
            <ChevronLeft />
          </Link>
        </div>
        <div className="detail-body">
          {res.phase === 'loading' && (
            <Loading label="Loading piece">
              <Skeleton h={28} w="85%" />
              <Skeleton h={18} w={80} />
              <Skeleton h={70} />
              <Skeleton h={50} r="999px" />
            </Loading>
          )}
          {res.phase === 'error' && (
            <StateView tone="error" icon={<CrackedBowlIcon />} title="This piece didn’t load" actions={<RetryButton onRetry={res.retry} />}>
              It may have just sold out, or our server had a hiccup.
            </StateView>
          )}
          {res.phase === 'ok' && (
            <>
              <h1 className="title title-lg">
                <PieceName name={res.data.name} glaze={res.data.glaze} />
              </h1>
              <p className="price">{euro(res.data.price)}</p>
              <p className="body">{res.data.blurb}</p>
              <dl className="specs">
                <div>
                  <dt>Size</dt>
                  <dd>{res.data.size}</dd>
                </div>
                <div>
                  <dt>Glaze</dt>
                  <dd>{res.data.glaze}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd className={res.data.stock > 0 && res.data.stock <= 2 ? 'low-stock' : ''}>
                    {res.data.stockUnknown ? 'Checking…' : res.data.stock === 0 ? 'Sold out' : res.data.stock <= 2 ? `Only ${res.data.stock} available` : 'In stock'}
                  </dd>
                </div>
              </dl>
              {res.data.stockUnknown && <Notice>We couldn’t check stock right now. You can still add it to your bag; we’ll confirm by email.</Notice>}
              <div className="detail-actions">
                <button type="button" className="btn btn-primary grow" onClick={addToBag} disabled={adding || res.data.stock === 0} aria-busy={adding} {...fc.target('add-to-bag')}>
                  {adding ? (
                    <>
                      <Spinner /> Adding…
                    </>
                  ) : res.data.stock === 0 ? (
                    'Sold out'
                  ) : (
                    'Add to bag'
                  )}
                </button>
                <button type="button" className={`btn btn-outline${saved ? ' is-on' : ''}`} aria-pressed={saved} onClick={save} {...fc.target('save')}>
                  <HeartIcon filled={saved} size={18} /> {saved ? 'Saved' : 'Save'}
                </button>
              </div>
              <p className="caption muted">Free delivery in Berlin from €80. Ships in two working days.</p>
            </>
          )}
        </div>
      </article>
      {sheet && res.phase === 'ok' && <SavedSheet product={res.data} onClose={() => setSheet(false)} />}
    </Shell>
  );
}

function SavedSheet({ product, onClose }: { product: P; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-layer">
      <button type="button" className="sheet-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={ref}>
        <span className="sheet-grip" aria-hidden="true" />
        <div className="sheet-row">
          <span className="thumb">
            <ProductPhoto product={product} />
          </span>
          <div>
            <h2 id="sheet-title" className="title-sm">
              Saved to wishlist
            </h2>
            <p className="caption muted">
              <PieceName name={product.name} glaze={product.glaze} /> · {euro(product.price)}
            </p>
          </div>
        </div>
        <p className="caption muted">We’ll let you know if it’s about to sell out.</p>
        <Link to="/wishlist" className="btn btn-primary btn-block" {...fc.target('view-wishlist')}>
          View wishlist
        </Link>
        <button type="button" className="text-link center-self" onClick={onClose} {...fc.target('keep-browsing')}>
          Keep browsing
        </button>
      </div>
    </div>
  );
}
