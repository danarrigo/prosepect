import { createRouter, createWebHistory } from 'vue-router'
import CalendarView from './views/CalendarView.vue'
import ProjectsView from './views/ProjectsView.vue'
import TodayView from './views/TodayView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'today', component: TodayView },
    { path: '/calendar', name: 'calendar', component: CalendarView },
    { path: '/projects', name: 'projects', component: ProjectsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
