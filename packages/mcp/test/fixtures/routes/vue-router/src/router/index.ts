import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import Home from '../views/Home.vue';
import User from '../views/User.vue';
import AdminLayout from '../views/AdminLayout.vue';
import { adminGuard } from './guards';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Home },
  { path: '/about', component: () => import('../views/About.vue') },
  { path: '/users/:id(\\d+)', component: User, meta: { requiresAuth: true } },
  {
    path: '/admin',
    component: AdminLayout,
    beforeEnter: adminGuard,
    children: [
      { path: '', component: () => import('../views/AdminHome.vue') },
      { path: 'users', component: () => import('../views/AdminUsers.vue') },
    ],
  },
  { path: '/home', redirect: '/' },
  { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue') },
];

export const router = createRouter({ history: createWebHistory(), routes });
