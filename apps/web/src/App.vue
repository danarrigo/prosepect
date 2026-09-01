<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { Bell, LogOut, Menu, Moon, RotateCw, Sun, X } from '@lucide/vue'
import * as api from './api/client'
import AppSidebar from './components/AppSidebar.vue'
import CreateTaskDialog from './components/CreateTaskDialog.vue'
import DailyReviewDialog from './components/DailyReviewDialog.vue'
import GlobalSearch from './components/GlobalSearch.vue'
import { dueInAppReminders, parseDismissedReminders, reminderKey } from './reminders'
import { useWorkspaceStore } from './stores/workspace'

const store = useWorkspaceStore()
const route = useRoute()
const sidebarOpen = ref(false)
const dark = ref(false)
const media = window.matchMedia('(prefers-color-scheme: dark)')
const now = ref(Date.now())
const dismissedReminders = ref<string[]>(loadDismissedReminders())
let reminderTimer: ReturnType<typeof setInterval> | undefined
const reportedReminders = new Set<string>()

const dueReminders = computed(() =>
  dueInAppReminders(store.tasks, now.value, dismissedReminders.value),
)

watch(dueReminders, (tasks) => {
  for (const task of tasks) {
    const key = reminderKey(task.id, task.remind_at!)
    if (reportedReminders.has(key)) continue
    reportedReminders.add(key)
    void api.recordReminderDelivery().catch(() => reportedReminders.delete(key))
  }
})

const pageTitle = computed(() => {
  if (route.name === 'calendar') return 'Calendar'
  if (route.name === 'projects') return 'Projects'
  if (route.name === 'notes') return 'Notes'
  if (route.name === 'files') return 'Files'
  if (route.name === 'settings') return 'Settings'
  return 'Today'
})

function applyTheme() {
  const preference = localStorage.getItem('prosepect.theme')
  dark.value = preference ? preference === 'dark' : media.matches
  document.documentElement.classList.toggle('dark', dark.value)
}

function toggleTheme() {
  localStorage.setItem('prosepect.theme', dark.value ? 'light' : 'dark')
  applyTheme()
}

function handleSystemTheme() {
  if (!localStorage.getItem('prosepect.theme')) applyTheme()
}

function dismissReminder(taskId: string, remindAt: string) {
  dismissedReminders.value = [...dismissedReminders.value, reminderKey(taskId, remindAt)].slice(
    -500,
  )
  localStorage.setItem('prosepect.dismissed-reminders', JSON.stringify(dismissedReminders.value))
}

function loadDismissedReminders() {
  return parseDismissedReminders(localStorage.getItem('prosepect.dismissed-reminders'))
}

onMounted(() => {
  applyTheme()
  media.addEventListener('change', handleSystemTheme)
  reminderTimer = setInterval(() => (now.value = Date.now()), 30_000)
  void store.bootstrap()
})

onBeforeUnmount(() => {
  media.removeEventListener('change', handleSystemTheme)
  if (reminderTimer) clearInterval(reminderTimer)
})
</script>

<template>
  <div
    v-if="store.authenticationRequired"
    class="grid min-h-dvh place-items-center bg-white px-5 text-slate-950 dark:bg-slate-950 dark:text-white"
  >
    <main class="w-full max-w-sm border-y border-slate-200 py-12 text-center dark:border-slate-800">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Prosepect</p>
      <h1 class="mt-4 text-3xl font-semibold tracking-[-0.04em]">Plan what matters.</h1>
      <p class="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">
        Sign in to open your private productivity workspace and connected calendars.
      </p>
      <a
        class="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        :href="api.apiUrl('/api/v1/auth/google/start')"
      >
        Continue with Google
      </a>
    </main>
  </div>

  <div v-else class="flex min-h-dvh bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <DailyReviewDialog />
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] lg:hidden"
      aria-hidden="true"
      @click="sidebarOpen = false"
    />
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />

    <div class="min-w-0 flex-1">
      <header
        class="sticky top-0 z-20 flex h-14 items-center border-b border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-950 sm:px-8"
      >
        <button
          class="icon-button mr-3 lg:hidden"
          type="button"
          aria-label="Open navigation"
          @click="sidebarOpen = true"
        >
          <Menu :size="19" />
        </button>
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">{{ pageTitle }}</span>
        <div class="ml-auto flex items-center gap-2">
          <GlobalSearch />
          <CreateTaskDialog />
          <button
            v-if="store.user"
            class="icon-button"
            type="button"
            aria-label="Sign out"
            title="Sign out"
            @click="store.logout"
          >
            <LogOut :size="17" />
          </button>
          <button
            class="icon-button"
            type="button"
            :aria-label="dark ? 'Use light theme' : 'Use dark theme'"
            @click="toggleTheme"
          >
            <Sun v-if="dark" :size="18" />
            <Moon v-else :size="18" />
          </button>
        </div>
      </header>

      <div
        v-if="store.error"
        class="mx-5 mt-4 flex items-start gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200 sm:mx-8"
        role="alert"
      >
        <span class="min-w-0 flex-1">{{ store.error }}</span>
        <button type="button" aria-label="Dismiss error" @click="store.clearError">
          <X :size="17" />
        </button>
      </div>

      <div
        v-for="task in dueReminders"
        :key="reminderKey(task.id, task.remind_at!)"
        class="mx-5 mt-4 flex items-center gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 sm:mx-8"
        role="status"
      >
        <Bell :size="17" class="shrink-0" />
        <span class="min-w-0 flex-1"><strong>Reminder:</strong> {{ task.title }}</span>
        <button
          type="button"
          :aria-label="`Dismiss reminder for ${task.title}`"
          @click="dismissReminder(task.id, task.remind_at!)"
        >
          <X :size="17" />
        </button>
      </div>

      <main>
        <div v-if="store.loading" class="grid min-h-[calc(100dvh-3.5rem)] place-items-center">
          <div class="flex items-center gap-3 text-sm text-slate-500">
            <RotateCw :size="18" class="animate-spin" />
            Loading…
          </div>
        </div>
        <RouterView v-else />
      </main>
    </div>
  </div>
</template>
