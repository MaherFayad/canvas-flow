import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { fc } from '@flowcanvas/sdk';

const NAV = [
  { to: '/catalog', label: 'Shop', fc: 'tab-shop', icon: 'M12 3.5a3 3 0 0 1 3 3V8h3.2l-1 12H6.8l-1-12H9V6.5a3 3 0 0 1 3-3z' },
  { to: '/classes', label: 'Classes', fc: 'tab-classes', icon: 'M12 4l8 15H4z M12 10v4' },
  { to: '/wishlist', label: 'Saved', fc: 'tab-saved', icon: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' },
  { to: '/bag', label: 'Bag', fc: 'tab-bag', icon: 'M6 8h12l-1 12H7z M9 8V6.5a3 3 0 0 1 6 0V8' },
];

/**
 * Page frame. Phone: content plus a bottom tab bar (Shop, Classes, Saved, Bag);
 * `bare` screens (onboarding, product, checkout flows) hide the tab bar.
 * From 768px: a top bar with the wordmark and the same four links, content centred.
 */
export function Shell({ children, bare = false, wide = false }: { children: ReactNode; bare?: boolean; wide?: boolean }) {
  return (
    <div className={`shell${bare ? ' shell-bare' : ''}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/catalog" className="wordmark" {...fc.target('wordmark')}>
            Helka ceramics
          </Link>
          <nav className="tabbar" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="tab" {...fc.target(n.fc)}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d={n.icon} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className={`main${wide ? ' main-wide' : ''}`} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
