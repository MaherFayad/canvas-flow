import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { euro, type Product } from '../data';
import { ProductPhoto } from './Photo';
import { PieceName, Skeleton } from './ui';

export function ProductCard({ p }: { p: Product }) {
  return (
    <li className="product-card">
      <Link to={`/product/${p.id}`} className="product-link" {...fc.target('product-card')}>
        <span className="product-photo">
          <ProductPhoto product={p} />
        </span>
        <span className="product-name">
          <PieceName name={p.name} glaze={p.glaze} />
        </span>
        <span className="product-price">
          {euro(p.price)}
          {p.stock > 0 && p.stock <= 2 && <span className="low-stock"> · Only {p.stock} available</span>}
          {p.stock === 0 && <span className="muted"> · Sold out</span>}
        </span>
      </Link>
    </li>
  );
}

export function ProductCardSkeleton() {
  return (
    <li className="product-card">
      <Skeleton className="product-photo" h="auto" r="var(--radius-card)" />
      <Skeleton h={14} w="80%" />
      <Skeleton h={12} w="40%" />
    </li>
  );
}
