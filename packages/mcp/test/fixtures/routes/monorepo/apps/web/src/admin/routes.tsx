import type { RouteObject } from 'react-router';
export const adminRoutes: RouteObject[] = [
  { index: true, element: <AdminHome /> },
  { path: 'users/:userId', element: <AdminUser /> },
];
