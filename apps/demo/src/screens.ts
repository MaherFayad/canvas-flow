import type { FcScreen } from '@flowcanvas/sdk';

/**
 * The 12 demo screens, declared to the canvas by `fc.init` and mirrored in
 * flowcanvas.config.json. The first state is the one the canvas opens first.
 */
export const SCREENS = [
  { id: 'welcome', title: 'Welcome', path: '/', group: 'onboarding', states: ['default', 'loading', 'error'] },
  { id: 'pick-interests', title: 'Pick interests', path: '/interests', group: 'onboarding', states: ['default', 'partial', 'loading', 'error'] },
  { id: 'catalog', title: 'Catalog', path: '/catalog', group: 'onboarding', states: ['default', 'loading', 'empty', 'partial', 'error'] },

  { id: 'product', title: 'Product detail', path: '/product/canele-dinner-plate', group: 'browse', states: ['default', 'saved', 'loading', 'partial', 'error'] },
  { id: 'wishlist', title: 'Wishlist', path: '/wishlist', group: 'browse', states: ['default', 'loading', 'empty', 'partial', 'error'] },

  { id: 'bag', title: 'Bag', path: '/bag', group: 'checkout', states: ['default', 'loading', 'empty', 'partial', 'error'] },
  { id: 'checkout', title: 'Checkout', path: '/checkout', group: 'checkout', states: ['default', 'loading', 'empty', 'error'] },
  { id: 'order-confirmed', title: 'Order confirmed', path: '/order-confirmed', group: 'checkout', states: ['success', 'loading', 'partial', 'error'] },

  { id: 'classes', title: 'Pottery classes', path: '/classes', group: 'classes', states: ['default', 'loading', 'empty', 'partial', 'error'] },
  { id: 'class', title: 'Class', path: '/classes/tableware-course', group: 'classes', states: ['default', 'loading', 'partial', 'error'] },
  { id: 'book-seat', title: 'Book a seat', path: '/classes/tableware-course/book', group: 'classes', states: ['default', 'loading', 'error'] },
  { id: 'seat-booked', title: 'Seat booked', path: '/classes/tableware-course/booked', group: 'classes', states: ['success', 'loading', 'error'] },
] satisfies FcScreen[];

export const GROUPS = [
  { id: 'onboarding', title: 'Onboarding' },
  { id: 'browse', title: 'Browse & save' },
  { id: 'checkout', title: 'Checkout' },
  { id: 'classes', title: 'Book a class' },
] as const;
