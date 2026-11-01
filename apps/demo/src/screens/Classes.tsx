import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { StudioPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { CrackedBowlIcon, Loading, Notice, RetryButton, Skeleton, StateView } from '../components/ui';
import { CLASSES, euro, type PotteryClass } from '../data';
import { useApi } from '../lib/useApi';

export function Classes() {
  const res = useApi<{ items: PotteryClass[] }>('/api/classes', {
    empty: { status: 200, body: { items: [] } },
    partial: { status: 200, body: { items: CLASSES.map((c) => (c.id === 'tableware-course' ? c : { ...c, seatsLeft: 0 })) } },
  });
  const full = res.phase === 'ok' ? res.data.items.filter((c) => c.seatsLeft === 0).length : 0;

  return (
    <Shell>
      <div className="page page-narrow">
        <header className="classes-head">
          <p className="eyebrow">Pottery classes · Kreuzberg</p>
          <h1 className="display">Learn at the wheel, in a small group.</h1>
          <p className="body muted">Courses and one-evening workshops in our studio on Oranienstraße. Six people per class; clay, aprons and firing included.</p>
        </header>
        {res.phase === 'loading' && (
          <Loading label="Loading classes">
            <div className="rows">
              {[0, 1, 2].map((i) => (
                <div key={i} className="row">
                  <Skeleton w={92} h={92} r="var(--radius-card)" />
                  <div className="grow stack-xs">
                    <Skeleton h={10} w={110} />
                    <Skeleton h={18} w="75%" />
                    <Skeleton h={12} w="55%" />
                  </div>
                </div>
              ))}
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" icon={<CrackedBowlIcon />} title="We couldn’t load the class calendar" actions={<RetryButton onRetry={res.retry} />}>
            Try again, or call the studio on +49 30 5557 0142 to book.
          </StateView>
        )}
        {full > 0 && <Notice>{full === 1 ? 'One class is' : `${full} classes are`} full this month. The tableware course still has seats.</Notice>}
        {res.phase === 'ok' && res.data.items.length > 0 && (
          <ul className="rows">
            {res.data.items.map((c) => (
              <li key={c.id} className={`row class-row${c.seatsLeft === 0 ? ' is-muted' : ''}`}>
                <Link to={`/classes/${c.id}`} className="class-link" {...fc.target('class-card')}>
                  <span className="thumb thumb-xl">
                    <StudioPhoto tone={c.tone} />
                  </span>
                  <span className="grow stack-xs">
                    <span className="eyebrow eyebrow-muted">
                      {c.kind} · {c.weeks.split(' · ')[0]}
                    </span>
                    <span className="row-title-lg">{c.title}</span>
                    <span className="caption muted">
                      {euro(c.price)} · Next {c.next}
                    </span>
                    <span className={`caption ${c.seatsLeft === 0 ? 'muted' : c.seatsLeft <= 2 ? 'low-stock' : 'muted'}`}>
                      {c.seatsLeft === 0 ? 'Full · join the waitlist' : `${c.seatsLeft} seats left`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {res.phase === 'ok' && res.data.items.length === 0 && (
          <StateView
            title="No classes on the calendar"
            actions={
              <Link to="/catalog" className="btn btn-outline" {...fc.target('browse-shop')}>
                Browse the shop
              </Link>
            }
          >
            January dates go up on December 1. Seats usually go within a day.
          </StateView>
        )}
      </div>
    </Shell>
  );
}
