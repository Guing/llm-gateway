import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/Register.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/components/Layout.vue'),
      children: [
        {
          path: '',
          redirect: '/dashboard',
        },
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/Dashboard.vue'),
        },
        {
          path: 'channels',
          name: 'Channels',
          component: () => import('@/views/Channels.vue'),
          meta: { adminOnly: true },
        },
        {
          path: 'priorities',
          name: 'Priorities',
          component: () => import('@/views/Priorities.vue'),
          meta: { adminOnly: true },
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('@/views/Users.vue'),
          meta: { adminOnly: true },
        },
        {
          path: 'api-keys',
          name: 'ApiKeys',
          component: () => import('@/views/ApiKeys.vue'),
        },
        {
          path: 'logs',
          name: 'Logs',
          component: () => import('@/views/Logs.vue'),
        },
        {
          path: 'system-logs',
          name: 'SystemLogs',
          component: () => import('@/views/SystemLogs.vue'),
          meta: { adminOnly: true },
        },
      ],
    },
  ],
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()

  if (!to.meta.public && !auth.token) {
    next('/login')
    return
  }

  if (to.meta.adminOnly && auth.user?.role !== 'admin') {
    next('/dashboard')
    return
  }

  next()
})

export default router
