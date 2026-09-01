import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'today', component: () => import('./views/TodayView.vue') },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('./views/CalendarView.vue'),
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('./views/ProjectsView.vue'),
    },
    { path: '/notes', name: 'notes', component: () => import('./views/NotesView.vue') },
    { path: '/files', name: 'files', component: () => import('./views/FilesView.vue') },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
