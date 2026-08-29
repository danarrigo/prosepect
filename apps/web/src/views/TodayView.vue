<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CreateProjectDialog from '../components/CreateProjectDialog.vue'
import QuickTaskForm from '../components/QuickTaskForm.vue'
import TaskList from '../components/TaskList.vue'
import { localDateKey, tasksForDate as findTasksForDate } from '../calendar'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const router = useRouter()
const today = ref(new Date())
let dateRefreshTimer: ReturnType<typeof setInterval> | undefined
const dateHeading = computed(() =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(today.value),
)

const dueToday = computed(() =>
  store.tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.due_at &&
      new Date(task.due_at).toDateString() === today.value.toDateString(),
  ),
)
const overdue = computed(() =>
  store.tasks.filter(
    (task) =>
      task.status !== 'completed' && task.due_at && new Date(task.due_at) < startOfDay(today.value),
  ),
)
const upcoming = computed(() =>
  store.tasks
    .filter(
      (task) =>
        !dueToday.value.includes(task) &&
        !overdue.value.includes(task) &&
        task.status !== 'completed',
    )
    .slice(0, 5),
)
const activeProjects = computed(() =>
  store.projects.filter((project) => project.status === 'active'),
)
const nextSevenDays = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const date = startOfDay(today.value)
    date.setDate(date.getDate() + index)
    return date
  }),
)

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function refreshDate() {
  today.value = new Date()
}

onMounted(() => {
  dateRefreshTimer = setInterval(refreshDate, 30_000)
  document.addEventListener('visibilitychange', refreshDate)
})

onBeforeUnmount(() => {
  if (dateRefreshTimer) clearInterval(dateRefreshTimer)
  document.removeEventListener('visibilitychange', refreshDate)
})

function openProject(projectId: string) {
  store.selectProject(projectId)
  void router.push('/projects')
}

function showAllProjects() {
  store.selectProject(null)
  void router.push('/projects')
}

function calendarTasks(date: Date) {
  return findTasksForDate(store.tasks, date).filter((task) => task.status !== 'completed')
}

function openCalendar(date: Date) {
  void router.push({ path: '/calendar', query: { date: localDateKey(date) } })
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
}

function compactDateLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function calendarAriaLabel(date: Date) {
  const label = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)
  return `Open ${label} in calendar`
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <div class="flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm text-slate-400 dark:text-slate-500">{{ dateHeading }}</p>
        <h1
          class="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-[2.5rem]"
        >
          Make today count.
        </h1>
      </div>
      <CreateProjectDialog />
    </div>

    <dl
      class="mt-9 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800"
    >
      <div class="py-4 pr-3 sm:px-8 sm:first:pl-0">
        <dt class="min-h-8 text-xs text-slate-400 sm:min-h-0">Open</dt>
        <dd class="mt-1 text-lg font-medium tabular-nums">{{ store.openTasks.length }}</dd>
      </div>
      <div class="px-3 py-4 sm:px-8">
        <dt class="min-h-8 text-xs text-slate-400 sm:min-h-0">Completed today</dt>
        <dd class="mt-1 text-lg font-medium tabular-nums">{{ store.completedToday }}</dd>
      </div>
      <div class="py-4 pl-3 sm:px-8">
        <dt class="min-h-8 text-xs text-slate-400 sm:min-h-0">Active projects</dt>
        <dd class="mt-1 text-lg font-medium tabular-nums">{{ activeProjects.length }}</dd>
      </div>
    </dl>

    <div class="mt-7">
      <QuickTaskForm />
    </div>

    <section class="mt-11">
      <div class="flex items-baseline justify-between pb-3">
        <h2 class="text-sm font-semibold">Calendar</h2>
        <button
          class="text-xs text-slate-400 transition hover:text-slate-900 dark:hover:text-white"
          type="button"
          @click="openCalendar(today)"
        >
          View month
        </button>
      </div>
      <div
        class="grid grid-cols-7 divide-x divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800"
      >
        <button
          v-for="date in nextSevenDays"
          :key="localDateKey(date)"
          class="min-w-0 py-3 text-center transition hover:bg-slate-50 dark:hover:bg-slate-900 sm:py-4"
          :class="{ 'bg-slate-50 dark:bg-slate-900': localDateKey(date) === localDateKey(today) }"
          type="button"
          :aria-label="calendarAriaLabel(date)"
          @click="openCalendar(date)"
        >
          <span class="block truncate text-[10px] uppercase tracking-wide text-slate-400">
            {{ weekdayLabel(date) }}
          </span>
          <span class="mt-1 block text-xs font-medium tabular-nums sm:text-sm">
            {{ compactDateLabel(date) }}
          </span>
          <span class="mt-1 block min-h-4 text-[10px] tabular-nums text-slate-400">
            {{ calendarTasks(date).length || '' }}
          </span>
        </button>
      </div>
    </section>

    <div class="mt-12 grid gap-14 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <section class="min-w-0">
        <div
          class="flex items-baseline justify-between border-b border-slate-200 pb-3 dark:border-slate-800"
        >
          <h2 class="text-sm font-semibold">Tasks</h2>
          <span class="text-xs tabular-nums text-slate-400">
            {{ dueToday.length + overdue.length }} due
          </span>
        </div>

        <div class="py-2">
          <div v-if="overdue.length" class="mb-6">
            <p class="list-heading text-rose-600 dark:text-rose-400">Overdue</p>
            <TaskList :tasks="overdue" :projects="store.projects" />
          </div>
          <div v-if="dueToday.length" class="mb-6">
            <p class="list-heading">Today</p>
            <TaskList :tasks="dueToday" :projects="store.projects" />
          </div>
          <div v-if="upcoming.length">
            <p class="list-heading">Next</p>
            <TaskList :tasks="upcoming" :projects="store.projects" />
          </div>
          <div v-if="!store.openTasks.length" class="py-16 text-center">
            <p class="text-sm text-slate-400">Nothing needs your attention.</p>
          </div>
        </div>
      </section>

      <section>
        <div
          class="flex items-baseline justify-between border-b border-slate-200 pb-3 dark:border-slate-800"
        >
          <h2 class="text-sm font-semibold">Projects</h2>
          <button
            class="text-xs text-slate-400 transition hover:text-slate-900 dark:hover:text-white"
            type="button"
            @click="showAllProjects"
          >
            View all
          </button>
        </div>
        <div>
          <button
            v-for="project in activeProjects.slice(0, 5)"
            :key="project.id"
            class="group block w-full border-b border-slate-100 py-4 text-left dark:border-slate-900"
            type="button"
            @click="openProject(project.id)"
          >
            <span
              class="block truncate text-sm font-medium text-slate-700 transition group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white"
            >
              {{ project.name }}
            </span>
            <span class="mt-1 block text-xs tabular-nums text-slate-400">
              {{ project.completed_tasks }} / {{ project.total_tasks }} complete
            </span>
          </button>
          <p v-if="!activeProjects.length" class="py-8 text-sm text-slate-400">
            No active projects.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
