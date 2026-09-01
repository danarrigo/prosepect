<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { CalendarDays, FileText, FolderKanban, LayoutDashboard, Settings, X } from '@lucide/vue'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useWorkspaceStore()
const route = useRoute()
const router = useRouter()
const visibleProjects = computed(() =>
  store.projects.filter((project) => project.status !== 'archived'),
)

function openProject(projectId: string) {
  store.selectProject(projectId)
  void router.push('/projects')
  emit('close')
}

function showAllProjects() {
  store.selectProject(null)
  emit('close')
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-slate-50 px-4 pb-5 pt-4 transition-transform duration-200 dark:border-slate-800 dark:bg-slate-950 lg:static lg:translate-x-0"
    :class="props.open ? 'translate-x-0' : '-translate-x-full'"
    aria-label="Primary navigation"
  >
    <div class="flex h-10 items-center justify-between px-2">
      <RouterLink class="text-sm font-semibold tracking-tight" to="/" @click="emit('close')">
        Prosepect
      </RouterLink>
      <button
        class="icon-button lg:hidden"
        type="button"
        aria-label="Close navigation"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>

    <nav class="mt-3 space-y-1">
      <RouterLink
        class="nav-item"
        :class="{ active: route.name === 'today' }"
        to="/"
        @click="emit('close')"
      >
        <LayoutDashboard :size="18" />
        <span>Today</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ active: route.name === 'calendar' }"
        to="/calendar"
        @click="emit('close')"
      >
        <CalendarDays :size="17" />
        <span>Calendar</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ active: route.name === 'notes' }"
        to="/notes"
        @click="emit('close')"
      >
        <FileText :size="17" />
        <span>Notes</span>
        <span v-if="store.notes.length" class="nav-count">{{ store.notes.length }}</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ active: route.name === 'projects' && !store.selectedProjectId }"
        to="/projects"
        @click="showAllProjects"
      >
        <FolderKanban :size="17" />
        <span>Projects</span>
        <span v-if="store.openTasks.length" class="nav-count">{{ store.openTasks.length }}</span>
      </RouterLink>
    </nav>

    <div v-if="visibleProjects.length" class="mt-8 px-2">
      <span class="text-[11px] font-medium text-slate-400">Your projects</span>
    </div>

    <div class="mt-2 min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="project in visibleProjects"
        :key="project.id"
        class="group flex h-9 w-full items-center rounded-md px-2 text-left text-sm text-slate-500 transition hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
        :class="{
          'bg-slate-100 !text-slate-950 dark:bg-slate-900 dark:!text-white':
            store.selectedProjectId === project.id,
        }"
        type="button"
        @click="openProject(project.id)"
      >
        <span class="truncate">{{ project.name }}</span>
      </button>
    </div>

    <RouterLink
      class="nav-item mt-3"
      :class="{ active: route.name === 'settings' }"
      to="/settings"
      @click="emit('close')"
    >
      <Settings :size="17" />
      <span>Settings</span>
    </RouterLink>
  </aside>
</template>
