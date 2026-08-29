<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import TaskList from '../components/TaskList.vue'
import {
  localDateKey as dateKey,
  parseLocalDateKey as parseDateKey,
  startOfLocalDay as startOfDay,
  tasksForDate as findTasksForDate,
} from '../calendar'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const route = useRoute()
const router = useRouter()
const today = ref(startOfDay(new Date()))
let dateRefreshTimer: ReturnType<typeof setInterval> | undefined
const initialDate = parseDateKey(route.query.date) ?? today.value
const selectedDate = ref(initialDate)
const monthCursor = ref(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthCursor.value),
)
const selectedLabel = computed(() =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(selectedDate.value),
)
const calendarDays = computed(() => {
  const first = new Date(monthCursor.value.getFullYear(), monthCursor.value.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
})
const selectedTasks = computed(() => tasksForDate(selectedDate.value))

function sameDay(first: Date, second: Date) {
  return dateKey(first) === dateKey(second)
}

function tasksForDate(date: Date) {
  return findTasksForDate(store.tasks, date)
}

function accessibleDateLabel(date: Date) {
  const label = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
  const count = tasksForDate(date).length
  return `${label}, ${count} ${count === 1 ? 'task' : 'tasks'}`
}

function selectDate(date: Date) {
  selectedDate.value = date
  if (
    date.getMonth() !== monthCursor.value.getMonth() ||
    date.getFullYear() !== monthCursor.value.getFullYear()
  ) {
    monthCursor.value = new Date(date.getFullYear(), date.getMonth(), 1)
  }
  void router.replace({ query: { date: dateKey(date) } })
}

function changeMonth(offset: number) {
  const next = new Date(monthCursor.value.getFullYear(), monthCursor.value.getMonth() + offset, 1)
  monthCursor.value = next
  selectDate(next)
}

function refreshToday() {
  today.value = startOfDay(new Date())
}

function goToToday() {
  monthCursor.value = new Date(today.value.getFullYear(), today.value.getMonth(), 1)
  selectDate(today.value)
}

onMounted(() => {
  dateRefreshTimer = setInterval(refreshToday, 30_000)
  document.addEventListener('visibilitychange', refreshToday)
})

onBeforeUnmount(() => {
  if (dateRefreshTimer) clearInterval(dateRefreshTimer)
  document.removeEventListener('visibilitychange', refreshToday)
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <div class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="page-title !mt-0">Calendar</h1>
        <p class="page-description">Tasks by due and scheduled date.</p>
      </div>
      <div class="flex items-center gap-1">
        <button class="secondary-button mr-2" type="button" @click="goToToday">Today</button>
        <button
          class="icon-button"
          type="button"
          aria-label="Previous month"
          @click="changeMonth(-1)"
        >
          <ChevronLeft :size="18" />
        </button>
        <button class="icon-button" type="button" aria-label="Next month" @click="changeMonth(1)">
          <ChevronRight :size="18" />
        </button>
      </div>
    </div>

    <div class="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section class="min-w-0" :aria-label="monthLabel">
        <h2 class="mb-4 text-sm font-semibold">{{ monthLabel }}</h2>
        <div class="grid grid-cols-7 border-l border-t border-slate-200 dark:border-slate-800">
          <div
            v-for="weekday in weekdays"
            :key="weekday"
            class="border-b border-r border-slate-200 px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800"
          >
            {{ weekday }}
          </div>
          <button
            v-for="date in calendarDays"
            :key="dateKey(date)"
            class="min-h-16 overflow-hidden border-b border-r border-slate-200 p-1.5 text-left align-top transition hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 dark:border-slate-800 dark:hover:bg-slate-900 sm:min-h-24 sm:p-2"
            :class="{
              'bg-slate-50 dark:bg-slate-900': sameDay(date, selectedDate),
              'text-slate-300 dark:text-slate-700': date.getMonth() !== monthCursor.getMonth(),
            }"
            type="button"
            :aria-label="accessibleDateLabel(date)"
            :aria-pressed="sameDay(date, selectedDate)"
            @click="selectDate(date)"
          >
            <span
              class="grid size-6 place-items-center rounded-full text-xs tabular-nums"
              :class="{
                'bg-slate-950 text-white dark:bg-white dark:text-slate-950': sameDay(date, today),
              }"
            >
              {{ date.getDate() }}
            </span>
            <span class="mt-1 flex gap-1 sm:hidden">
              <span
                v-for="task in tasksForDate(date).slice(0, 3)"
                :key="task.id"
                class="size-1 rounded-full bg-slate-500"
              />
            </span>
            <span class="mt-1 hidden space-y-1 sm:block">
              <span
                v-for="task in tasksForDate(date).slice(0, 2)"
                :key="task.id"
                class="block truncate text-[10px] leading-4 text-slate-500 dark:text-slate-400"
                :class="{ 'line-through opacity-50': task.status === 'completed' }"
              >
                {{ task.title }}
              </span>
              <span v-if="tasksForDate(date).length > 2" class="block text-[10px] text-slate-400">
                +{{ tasksForDate(date).length - 2 }} more
              </span>
            </span>
          </button>
        </div>
      </section>

      <section class="min-w-0">
        <div
          class="flex items-baseline justify-between border-b border-slate-200 pb-3 dark:border-slate-800"
        >
          <div>
            <h2 class="text-sm font-semibold">{{ selectedLabel }}</h2>
            <p class="mt-1 text-xs text-slate-400">
              {{ selectedTasks.length }} {{ selectedTasks.length === 1 ? 'task' : 'tasks' }}
            </p>
          </div>
        </div>
        <div class="py-2">
          <TaskList
            :tasks="selectedTasks"
            :projects="store.projects"
            empty-message="Nothing scheduled."
          />
        </div>
      </section>
    </div>
  </div>
</template>
