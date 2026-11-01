import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { ProductPhoto, TablePhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { CrackedBowlIcon, Loading, RetryButton, Skeleton, StateView } from '../components/ui';
import type { Product } from '../data';
import { useApi } from '../lib/useApi';

export function Welcome() {
  const home = useApi<{ featured: Product[] }>('/api/home');

  return (
    <Shell bare>
      <div className="welcome">
        <div className="collage">
          {home.phase === 'loading' && (
            <Loading label="Loading">
              <Skeleton className="collage-a" h="100%" r="0" />
              <Skeleton className="collage-b" h="100%" r="0" />
              <Skeleton className="collage-c" h="100%" r="0" />
            </Loading>
          )}
          {home.phase === 'ok' && (
            <>
              <TablePhoto className="collage-a" />
              <ProductPhoto className="collage-b" product={home.data.featured[0]!} />
              <ProductPhoto className="collage-c" product={home.data.featured[1]!} />
            </>
          )}
          {home.phase === 'error' && (
            <div className="collage-error">
              <StateView tone="error" icon={<CrackedBowlIcon />} title="The studio is out of reach" actions={<RetryButton onRetry={home.retry} />}>
                Check your connection. You can still look around; we’ll load the pictures when you’re back.
              </StateView>
            </div>
          )}
        </div>
        <div className="welcome-copy">
          <p className="eyebrow">Helka ceramics · Berlin</p>
          <h1 className="display">Stoneware for slow mornings and long dinners.</h1>
          <p className="body muted">Cups, bowls and plates thrown by hand in our Kreuzberg studio, and pottery classes for anyone who wants to make their own.</p>
          <div className="welcome-actions">
            <Link to="/interests" className="btn btn-primary btn-block" {...fc.target('get-started')}>
              Get started
            </Link>
            <Link to="/catalog" className="text-link" {...fc.target('skip')}>
              Skip
            </Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}
