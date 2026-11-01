import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Index });
const postsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'posts', component: Posts });
const postsIndexRoute = createRoute({ getParentRoute: () => postsRoute, path: '/', component: PostsIndex });
const postRoute = createRoute({ getParentRoute: () => postsRoute, path: '$postId', component: Post });
const authLayout = createRoute({ getParentRoute: () => rootRoute, id: 'auth', beforeLoad: () => {} });
const dashboardRoute = createRoute({ getParentRoute: () => authLayout, path: 'dashboard', component: Dashboard });

const routeTree = rootRoute.addChildren([indexRoute, postsRoute.addChildren([postsIndexRoute, postRoute]), authLayout.addChildren([dashboardRoute])]);
export const router = createRouter({ routeTree });
