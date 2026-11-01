import { Link, useParams } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { StudioPhoto } from '../components/Photo';
import { Shell } from '../components/Shell';
import { ChevronLeft, CrackedBowlIcon, Loading, Notice, RetryButton, Skeleton, StateView } from '../components/ui';
import { CLASSES, classById, euro, type PotteryClass } from '../data';
import { useApi } from '../lib/useApi';

export function ClassDetail() {
  const { id = 'tableware-course' } = useParams();
  const sample = classById(id) ?? CLASSES[0]!;
  const res = useApi<PotteryClass>(`/api/classes/${id}`, { partial: { status: 200, body: { ...sample, seatsLeft: 1 } } });

  return (
    <Shell bare>
      <article className="detail">
        <div className="detail-photo detail-photo-wide">
          {res.phase === 'ok' ? <StudioPhoto tone={res.data.tone} /> : <Skeleton h="100%" r="0" />}
          <Link to="/classes" className="photo-back" aria-label="Back to classes" {...fc.target('back-to-classes')}>
            <ChevronLeft />
          </Link>
        </div>
        <div className="detail-body">
          {res.phase === 'loading' && (
            <Loading label="Loading class">
              <Skeleton h={10} w={160} />
              <Skeleton h={28} w="80%" />
              <Skeleton h={16} w={130} />
              <Skeleton h={80} />
            </Loading>
          )}
          {res.phase === 'error' && (
            <StateView tone="error" icon={<CrackedBowlIcon />} title="This class didn’t load" actions={<RetryButton onRetry={res.retry} />}>
              It may have moved to a new date. Try again, or go back to the calendar.
            </StateView>
          )}
          {res.phase === 'ok' && (
            <>
              <p className="eyebrow eyebrow-muted">
                {res.data.kind} · {res.data.weeks}
              </p>
              <h1 className="title title-lg">{res.data.title}</h1>
              <p className="price">
                {euro(res.data.price)} <span className="muted caption">per person</span>
              </p>
              <p className="body">{res.data.blurb}</p>
              <section aria-labelledby="sessions">
                <h2 id="sessions" className="section-label">
                  {res.data.sessions.length > 1 ? 'Sessions' : 'Date'}
                </h2>
                <ul className="session-list">
                  {res.data.sessions.map((s, i) => (
                    <li key={s}>
                      <span>{s}</span>
                      <span className="muted">{i === 0 ? `with ${res.data.teacher}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {res.data.seatsLeft === 1 && <Notice tone="danger">Only 1 seat left on this {res.data.kind.toLowerCase()}.</Notice>}
              <Link to={`/classes/${res.data.id}/book`} className="btn btn-primary btn-block" {...fc.target('book-seat')}>
                Book a seat
              </Link>
              <p className="caption muted center">Free cancellation up to 7 days before the first session.</p>
            </>
          )}
        </div>
      </article>
    </Shell>
  );
}
