import { Link, useParams } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { Shell } from '../components/Shell';
import { CheckIcon, Loading, RetryButton, Skeleton, StateView } from '../components/ui';
import type { PotteryClass } from '../data';
import { useApi } from '../lib/useApi';

export function SeatBooked() {
  const { id = 'tableware-course' } = useParams();
  const res = useApi<PotteryClass>(`/api/classes/${id}`);

  return (
    <Shell bare>
      <div className="page page-narrow page-center">
        {res.phase === 'loading' && (
          <Loading label="Confirming your booking">
            <div className="stack center-items">
              <Skeleton w={56} h={56} r="50%" />
              <Skeleton h={28} w={220} />
              <Skeleton h={14} w="80%" />
            </div>
          </Loading>
        )}
        {res.phase === 'error' && (
          <StateView tone="error" title="Your seat is booked" actions={<RetryButton onRetry={res.retry} label="Show details" />}>
            We couldn’t load the details here, but the confirmation is in your email.
          </StateView>
        )}
        {res.phase === 'ok' && (
          <StateView
            tone="success"
            icon={<CheckIcon size={26} />}
            title="See you at the wheel"
            actions={
              <>
                <a href="data:text/calendar;charset=utf-8,BEGIN:VCALENDAR%0AEND:VCALENDAR" download="helka-class.ics" className="btn btn-outline btn-block" {...fc.target('add-to-calendar')}>
                  Add to calendar
                </a>
                <Link to="/catalog" className="btn btn-primary btn-block" {...fc.target('back-to-shop')}>
                  Back to the shop
                </Link>
              </>
            }
          >
            You’re booked on the {res.data.title}, starting {res.data.next}. We’ve emailed the details and directions to the studio. Wear something that can get muddy.
          </StateView>
        )}
      </div>
    </Shell>
  );
}
