import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { ProductPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { CrackedBowlIcon, HeartIcon, Loading, Notice, PieceName, RetryButton, ScreenTitle, Skeleton, StateView } from '../components/ui';
import { WISHLIST_IDS, euro, productById, type CatalogResponse, type Product } from '../data';
import { postJson, useApi } from '../lib/useApi';

export function Wishlist() {
  const navigate = useNavigate();
  const res = useApi<CatalogResponse>('/api/wishlist', {
    empty: { status: 200, body: { items: [] } },
    partial: { status: 200, body: { items: [...WISHLIST_IDS.map((id) => productById(id)), productById('dinner-plate-periwinkle')] } },
  });
  const loaded = res.phase === 'ok' ? res.data.items : null;
  const [items, setItems] = useState<Product[] | null>(null);
  useEffect(() => {
    setItems(loaded);
  }, [loaded]);
  const soldOut = items?.filter((p) => p.stock === 0) ?? [];

  async function addToBag(id: string) {
    await postJson('/api/bag', { productId: id });
    navigate('/bag');
  }

  return (
    <Shell>
      <div className="page page-narrow">
        <ScreenTitle title="Wishlist" sub={items && items.length > 0 ? `${items.length} ${items.length === 1 ? 'piece' : 'pieces'} saved` : undefined} />
        {res.phase === 'loading' && (
          <Loading label="Loading your wishlist">
            <div className="rows">
              {[0, 1, 2].map((i) => (
                <div key={i} className="row">
                  <Skeleton w={76} h={76} r="var(--radius-card)" />
                  <div className="grow stack-xs">
                    <Skeleton h={14} w="60%" />
                    <Skeleton h={12} w="30%" />
                  </div>
                </div>
              ))}
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load your wishlist" actions={<RetryButton onRetry={res.retry} />}>
            Your saved pieces are safe. Try again in a moment.
          </StateView>
        )}
        {soldOut.length > 0 && <Notice>{soldOut.length === 1 ? 'One saved piece has sold out.' : `${soldOut.length} saved pieces have sold out.`} We’ll tell you when it’s back from the kiln.</Notice>}
        {items && items.length > 0 && (
          <ul className="rows">
            {items.map((p) => (
              <li key={p.id} className={`row${p.stock === 0 ? ' is-muted' : ''}`}>
                <Link to={`/product/${p.id}`} className="thumb thumb-lg" aria-label={`${p.name}, ${p.glaze}`} tabIndex={-1}>
                  <ProductPhoto product={p} />
                </Link>
                <div className="grow">
                  <p className="row-title">
                    <PieceName name={p.name} glaze={p.glaze} />
                  </p>
                  <p className="row-price">{p.stock === 0 ? 'Sold out' : euro(p.price)}</p>
                  <p className="row-actions">
                    {p.stock > 0 && (
                      <>
                        <button type="button" className="text-link" onClick={() => addToBag(p.id)} {...fc.target(`wishlist-add-${p.id}`)}>
                          Add to bag
                        </button>
                        <span aria-hidden="true"> · </span>
                      </>
                    )}
                    <button type="button" className="text-link muted" onClick={() => setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null)} {...fc.target(`wishlist-remove-${p.id}`)}>
                      Remove
                    </button>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {items && items.length === 0 && (
          <StateView
            icon={<HeartIcon />}
            title="Nothing saved yet"
            actions={
              <Link to="/catalog" className="btn btn-outline" {...fc.target('browse-shop')}>
                Browse the shop
              </Link>
            }
          >
            Tap Save on any piece to keep it here. Most pieces come in small runs, so we’ll warn you before one sells out.
          </StateView>
        )}
      </div>
    </Shell>
  );
}
