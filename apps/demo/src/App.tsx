import { useEffect } from 'react';
import { Link, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { Shell } from './components/Shell';
import { BowlIcon, StateView } from './components/ui';
import { Bag } from './screens/Bag';
import { BookSeat } from './screens/BookSeat';
import { Catalog } from './screens/Catalog';
import { Checkout } from './screens/Checkout';
import { ClassDetail } from './screens/ClassDetail';
import { Classes } from './screens/Classes';
import { OrderConfirmed } from './screens/OrderConfirmed';
import { PickInterests } from './screens/PickInterests';
import { Product } from './screens/Product';
import { SeatBooked } from './screens/SeatBooked';
import { Welcome } from './screens/Welcome';
import { Wishlist } from './screens/Wishlist';

function Root() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return <Outlet />;
}

function NotFound() {
  return (
    <Shell>
      <div className="page page-narrow">
        <StateView
          icon={<BowlIcon />}
          title="This page isn’t here"
          actions={
            <Link to="/catalog" className="btn btn-primary">
              Go to the shop
            </Link>
          }
        >
          It may have moved, or the link has a typo.
        </StateView>
      </div>
    </Shell>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Welcome /> },
      { path: '/interests', element: <PickInterests /> },
      { path: '/catalog', element: <Catalog /> },
      { path: '/product/:id', element: <Product /> },
      { path: '/wishlist', element: <Wishlist /> },
      { path: '/bag', element: <Bag /> },
      { path: '/checkout', element: <Checkout /> },
      { path: '/order-confirmed', element: <OrderConfirmed /> },
      { path: '/classes', element: <Classes /> },
      { path: '/classes/:id', element: <ClassDetail /> },
      { path: '/classes/:id/book', element: <BookSeat /> },
      { path: '/classes/:id/booked', element: <SeatBooked /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
