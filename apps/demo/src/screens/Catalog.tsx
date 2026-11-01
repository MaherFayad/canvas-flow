import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { StudioPhoto } from '../components/Photo';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { Shell } from '../components/Shell';
import { BowlIcon, CrackedBowlIcon, Loading, Notice, RetryButton, StateView } from '../components/ui';
import { PRODUCTS, type CatalogResponse } from '../data';
import { useApi } from '../lib/useApi';

const FILTERS = ['all', 'cups', 'bowls', 'plates', 'interior'] as const;

export function Catalog() {
  const res = useApi<CatalogResponse>('/api/products', {
    empty: { status: 200, body: { items: [] } },
    partial: { status: 200, body: { items: PRODUCTS.slice(0, 6), unavailable: 6 } },
  });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const items = res.phase === 'ok' ? res.data.items.filter((p) => filter === 'all' || p.category === filter) : [];

  return (
    <Shell wide>
      <div className="page">
        <header className="catalog-head">
          <p className="brand-line">Helka ceramics</p>
          <h1 className="display display-italic">Current collection</h1>
          <p className="body muted intro">
            Stoneware for the table and home, thrown on the wheel in our Berlin studio. Made for the small rituals: the first coffee, the long dinner with
            friends. Every piece is unique and comes in small runs.
          </p>
        </header>

        <div className="filters" role="group" aria-label="Filter the collection">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`chip chip-caps${filter === f ? ' is-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)} {...fc.target(`filter-${f}`)}>
              {f}
            </button>
          ))}
        </div>

        {res.phase === 'loading' && (
          <Loading label="Loading the collection">
            <ul className="product-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </ul>
          </Loading>
        )}

        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load the shop" actions={<RetryButton onRetry={res.retry} />}>
            Something went wrong on our side. Your bag and wishlist are safe; try again in a moment.
          </StateView>
        )}

        {res.phase === 'ok' && res.data.unavailable ? (
          <Notice>
            <span>
              {res.data.unavailable} pieces didn’t load. Showing {res.data.items.length} of {res.data.items.length + res.data.unavailable}.
            </span>
            <button type="button" className="text-link" onClick={res.retry} {...fc.target('retry-partial')}>
              Retry
            </button>
          </Notice>
        ) : null}

        {res.phase === 'ok' && items.length > 0 && (
          <ul className="product-grid">
            {items.map((p, i) => (
              <Fragment key={p.id}>
                <ProductCard p={p} />
                {i === 3 && filter === 'all' && <ClassPromo />}
              </Fragment>
            ))}
            {items.length <= 4 && filter === 'all' && <ClassPromo />}
          </ul>
        )}

        {res.phase === 'ok' && items.length === 0 && (
          <StateView
            icon={<BowlIcon />}
            title="Nothing matches yet"
            actions={
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFilter('all');
                  if (res.data.items.length === 0) res.retry();
                }}
                {...fc.target('clear-filters')}
              >
                Clear filters
              </button>
            }
          >
            {res.data.items.length === 0
              ? 'The last firing sold out. New pieces come out of the kiln on Friday.'
              : 'No pieces in this category right now. Clear the filter to see everything.'}
          </StateView>
        )}
      </div>
    </Shell>
  );
}

function ClassPromo() {
  return (
    <li className="promo">
      <Link to="/classes" className="promo-link" {...fc.target('see-classes')}>
        <span className="promo-photo">
          <StudioPhoto />
        </span>
        <span className="promo-copy">
          <span className="eyebrow">Pottery classes</span>
          <span className="promo-title">Make your own at the wheel</span>
          <span className="text-link">See the classes</span>
        </span>
      </Link>
    </li>
  );
}
