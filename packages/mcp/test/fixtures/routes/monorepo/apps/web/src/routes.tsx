import type { RouteObject } from 'react-router';
import { adminRoutes } from './admin/routes';
export const routes: RouteObject[] = [
  { path: '/', element: <Home /> },
  { path: '/admin', element: <Admin />, children: adminRoutes },
];
