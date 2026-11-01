import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fc } from '@flowcanvas/sdk';

export function Skeleton({ h = 14, w = '100%', r = '6px', className = '' }: { h?: number | string; w?: number | string; r?: string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ height: h, width: w, borderRadius: r }} />;
}

/** Announces loading to screen readers; the skeleton children are hidden from them. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="loading" aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden="true" className="loading-body">
        {children}
      </div>
    </div>
  );
}

/** Centred message for empty, error and success screens. */
export function StateView({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
}: {
  tone?: 'neutral' | 'error' | 'success';
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`state-view state-${tone}`} role={tone === 'error' ? 'alert' : undefined} aria-labelledby="state-title">
      {icon && <div className="state-icon">{icon}</div>}
      <h2 id="state-title" className="state-title">
        {title}
      </h2>
      {children && <div className="state-body">{children}</div>}
      {actions && <div className="state-actions">{actions}</div>}
    </section>
  );
}

export function RetryButton({ onRetry, label = 'Try again' }: { onRetry: () => void; label?: string }) {
  return (
    <button type="button" className="btn btn-outline" onClick={onRetry} {...fc.target('retry')}>
      {label}
    </button>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Back chevron + serif screen title, as on the reference screens. */
export function ScreenTitle({ back, title, sub }: { back?: { to: string; label: string; fc: string }; title: string; sub?: ReactNode }) {
  return (
    <div className="screen-title">
      <div className="screen-title-row">
        {back && (
          <Link to={back.to} className="back-link" aria-label={back.label} {...fc.target(back.fc)}>
            <ChevronLeft />
          </Link>
        )}
        <h1 className="title">{title}</h1>
      </div>
      {sub && <p className="caption muted">{sub}</p>}
    </div>
  );
}

export function PieceName({ name, glaze }: { name: string; glaze: string }) {
  return (
    <>
      {name} <span className="glaze">— {glaze}</span>
    </>
  );
}

export function ChevronLeft({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeartIcon({ filled = false, size = 22 }: { filled?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function CrackedBowlIcon() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path d="M6 20h36a18 16 0 0 1-36 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M25 20l-3 6 4 3-2 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BowlIcon() {
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
      <path d="M6 20h36a18 16 0 0 1-36 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M18 13c0-3 3-3 3-6M27 13c0-3 3-3 3-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
