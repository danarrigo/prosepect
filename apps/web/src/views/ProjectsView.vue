<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Archive, ArrowLeft, Pencil, RotateCcw, Search, X } from '@lucide/vue'
import { useRoute } from 'vue-router'
import type { Project, ProjectStatus, TaskPriority, TaskStatus } from '../api/types'
import AttachmentPanel from '../components/AttachmentPanel.vue'
import CreateProjectDialog from '../components/CreateProjectDialog.vue'
import QuickTaskForm from '../components/QuickTaskForm.vue'
import TaskList from '../components/TaskList.vue'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const route = useRoute()
const selected = computed(() => store.selectedProject)
const showArchived = ref(false)
const editingProject = ref(false)
const projectName = ref('')
const projectOutcome = ref('')
const projectTargetDate = ref('')
const projectStatus = ref<ProjectStatus>('active')
const search = ref('')
const statusFilter = ref<'open' | 'all' | TaskStatus>('open')
const priorityFilter = ref<'all' | TaskPriority>('all')
const labelFilter = ref('all')
const sortBy = ref<'manual' | 'due' | 'priority' | 'title'>('manual')

const visibleProjects = computed(() =>
  store.projects.filter((project) => showArchived.value || project.status !== 'archived'),
)
const archivedCount = computed(
  () => store.projects.filter((project) => project.status === 'archived').length,
)
const baseTasks = computed(() => (selected.value ? store.selectedTasks : store.tasks))
const labels = computed(() =>
  [...new Set(baseTasks.value.flatMap((task) => task.labels))].sort((first, second) =>
    first.localeCompare(second),
  ),
)
const visibleTasks = computed(() => {
  const query = search.value.trim().toLowerCase()
  const filtered = baseTasks.value.filter((task) => {
    const matchesSearch =
      !query ||
      task.title.toLowerCase().includes(query) ||
      task.description.toLowerCase().includes(query) ||
      task.labels.some((label) => label.includes(query))
    const matchesStatus =
      statusFilter.value === 'all' ||
      (statusFilter.value === 'open'
        ? task.status !== 'completed'
        : task.status === statusFilter.value)
    const matchesPriority = priorityFilter.value === 'all' || task.priority === priorityFilter.value
    const matchesLabel = labelFilter.value === 'all' || task.labels.includes(labelFilter.value)
    return matchesSearch && matchesStatus && matchesPriority && matchesLabel
  })

  return [...filtered].sort((first, second) => {
    if (sortBy.value === 'due') {
      return nullableTime(first.due_at) - nullableTime(second.due_at)
    }
    if (sortBy.value === 'priority') {
      return priorityRank(second.priority) - priorityRank(first.priority)
    }
    if (sortBy.value === 'title') return first.title.localeCompare(second.title)
    return Number(first.position) - Number(second.position)
  })
})
const taskFilterActive = computed(
  () =>
    Boolean(search.value) ||
    statusFilter.value !== 'open' ||
    priorityFilter.value !== 'all' ||
    labelFilter.value !== 'all' ||
    sortBy.value !== 'manual',
)

watch(selected, () => {
  editingProject.value = false
  resetTaskFilters()
})

watch(
  () => route.query,
  (query) => {
    if (typeof query.project === 'string') store.selectProject(query.project)
    if (typeof query.search === 'string') {
      store.selectProject(null)
      search.value = query.search
      statusFilter.value = 'all'
    }
  },
  { immediate: true },
)

function progress(project: Project) {
  if (!project.total_tasks) return 0
  return Math.round((project.completed_tasks / project.total_tasks) * 100)
}

function targetLabel(value?: string | null) {
  if (!value) return 'No target date'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function beginProjectEdit() {
  const project = selected.value
  if (!project) return
  projectName.value = project.name
  projectOutcome.value = project.outcome
  projectTargetDate.value = project.target_date ?? ''
  projectStatus.value = project.status
  editingProject.value = true
}

async function submitProjectEdit() {
  const project = selected.value
  if (!project || !projectName.value.trim()) return
  try {
    await store.editProject(project, {
      name: projectName.value.trim(),
      outcome: projectOutcome.value.trim(),
      target_date: projectTargetDate.value || null,
      status: projectStatus.value,
    })
    editingProject.value = false
  } catch {
    // The store presents the API error globally.
  }
}

async function toggleArchive() {
  const project = selected.value
  if (!project) return
  try {
    await store.editProject(project, {
      name: project.name,
      outcome: project.outcome,
      target_date: project.target_date ?? null,
      status: project.status === 'archived' ? 'active' : 'archived',
    })
  } catch {
    // The store presents the API error globally.
  }
}

async function removeProject() {
  const project = selected.value
  if (!project) return

  const taskCount = baseTasks.value.length
  const contents = taskCount ? ` and ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}` : ''
  if (!window.confirm(`Delete “${project.name}”${contents}? This cannot be undone.`)) return

  try {
    await store.removeProject(project)
  } catch {
    // The store presents the API error globally.
  }
}

function resetTaskFilters() {
  search.value = ''
  statusFilter.value = 'open'
  priorityFilter.value = 'all'
  labelFilter.value = 'all'
  sortBy.value = 'manual'
}

function nullableTime(value?: string | null) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER
}

function priorityRank(priority: TaskPriority) {
  return { low: 1, medium: 2, high: 3, urgent: 4 }[priority]
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <template v-if="!selected">
      <div class="flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="page-title !mt-0">Projects</h1>
          <p class="page-description">Outcomes and the work required to reach them.</p>
        </div>
        <CreateProjectDialog />
      </div>

      <div
        class="mt-8 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800"
      >
        <p class="text-xs text-slate-400">{{ visibleProjects.length }} projects</p>
        <button
          v-if="archivedCount"
          class="text-xs text-slate-400 transition hover:text-slate-950 dark:hover:text-white"
          type="button"
          @click="showArchived = !showArchived"
        >
          {{ showArchived ? 'Hide' : 'Show' }} archived ({{ archivedCount }})
        </button>
      </div>

      <div v-if="visibleProjects.length">
        <button
          v-for="project in visibleProjects"
          :key="project.id"
          class="group grid w-full gap-3 border-b border-slate-200 py-5 text-left transition dark:border-slate-800 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem] sm:items-center"
          type="button"
          @click="store.selectProject(project.id)"
        >
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-slate-900 dark:text-white">
              {{ project.name }}
            </span>
            <span class="mt-1 block truncate text-xs text-slate-400">
              {{ project.outcome || 'No outcome' }}
            </span>
          </span>
          <span class="text-xs capitalize text-slate-500 dark:text-slate-400">
            {{ project.status }}
          </span>
          <span class="text-xs tabular-nums text-slate-400">
            {{ project.completed_tasks }} / {{ project.total_tasks }} tasks
          </span>
          <span class="text-xs tabular-nums text-slate-400 sm:text-right">
            {{ targetLabel(project.target_date) }}
          </span>
        </button>
      </div>

      <div v-else class="py-16">
        <h2 class="text-sm font-medium">
          {{ showArchived ? 'No projects yet' : 'No active projects' }}
        </h2>
        <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
          Create a project to group tasks around an outcome.
        </p>
      </div>
    </template>

    <template v-else>
      <button
        class="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-900 dark:hover:text-white"
        type="button"
        @click="store.selectProject(null)"
      >
        <ArrowLeft :size="15" />
        Projects
      </button>

      <form
        v-if="editingProject"
        class="mt-9 border-y border-slate-200 py-6 dark:border-slate-800"
        aria-label="Edit project"
        @submit.prevent="submitProjectEdit"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field-label sm:col-span-2">
            Project name
            <input v-model="projectName" class="field-input" maxlength="120" required autofocus />
          </label>
          <label class="field-label sm:col-span-2">
            Desired outcome
            <textarea
              v-model="projectOutcome"
              class="field-input min-h-24 resize-y py-3"
              maxlength="2000"
            />
          </label>
          <label class="field-label">
            Target date
            <input v-model="projectTargetDate" class="field-input" type="date" />
          </label>
          <label class="field-label">
            Status
            <select v-model="projectStatus" class="field-input">
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="secondary-button" type="button" @click="editingProject = false">
            Cancel
          </button>
          <button
            class="primary-button"
            type="submit"
            :disabled="store.saving || !projectName.trim()"
          >
            Save project
          </button>
        </div>
      </form>

      <div v-else class="mt-9">
        <div class="flex flex-col items-start gap-6 sm:flex-row sm:justify-between">
          <div class="min-w-0 flex-1">
            <h1 class="page-title !mt-0">{{ selected.name }}</h1>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {{ selected.outcome || 'No outcome described.' }}
            </p>
            <div class="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
              <span class="capitalize">{{ selected.status }}</span>
              <span>{{ targetLabel(selected.target_date) }}</span>
              <span class="tabular-nums">
                {{ selected.completed_tasks }} of {{ selected.total_tasks }} tasks complete
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              class="icon-button"
              type="button"
              aria-label="Edit project"
              @click="beginProjectEdit"
            >
              <Pencil :size="16" />
            </button>
            <button
              class="icon-button"
              type="button"
              :aria-label="selected.status === 'archived' ? 'Restore project' : 'Archive project'"
              :disabled="store.saving"
              @click="toggleArchive"
            >
              <RotateCcw v-if="selected.status === 'archived'" :size="16" />
              <Archive v-else :size="16" />
            </button>
          </div>
        </div>
        <div class="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-900">
          <div
            class="h-full rounded-full bg-slate-700 transition-all dark:bg-slate-300"
            :style="{ width: `${progress(selected)}%` }"
          />
        </div>
        <div class="mt-6">
          <AttachmentPanel kind="project" :parent-id="selected.id" />
        </div>
      </div>

      <div v-if="selected.status !== 'archived'" class="mt-9"><QuickTaskForm /></div>
      <p
        v-else
        class="mt-9 border-y border-slate-200 py-4 text-sm text-slate-400 dark:border-slate-800"
      >
        Restore this project to add new tasks.
      </p>
    </template>

    <section v-if="store.tasks.length || selected" class="mt-14">
      <div
        class="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2 class="text-sm font-semibold">{{ selected ? 'Project tasks' : 'All tasks' }}</h2>
          <p class="mt-1 text-xs text-slate-400">{{ visibleTasks.length }} shown</p>
        </div>
        <button
          v-if="taskFilterActive"
          class="inline-flex items-center gap-1 self-start text-xs text-slate-400 transition hover:text-slate-950 dark:hover:text-white"
          type="button"
          @click="resetTaskFilters"
        >
          <X :size="13" /> Clear filters
        </button>
      </div>

      <div
        class="grid gap-2 border-b border-slate-100 py-4 dark:border-slate-900 sm:grid-cols-[minmax(12rem,1fr)_repeat(4,auto)]"
      >
        <label class="relative">
          <Search :size="14" class="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <span class="sr-only">Search tasks</span>
          <input
            v-model="search"
            class="filter-control w-full pl-8"
            type="search"
            placeholder="Search tasks"
          />
        </label>
        <select v-model="statusFilter" class="filter-control" aria-label="Filter by status">
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
        <select v-model="priorityFilter" class="filter-control" aria-label="Filter by priority">
          <option value="all">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <select v-model="labelFilter" class="filter-control" aria-label="Filter by label">
          <option value="all">All labels</option>
          <option v-for="label in labels" :key="label" :value="label">{{ label }}</option>
        </select>
        <select v-model="sortBy" class="filter-control" aria-label="Sort tasks">
          <option value="manual">Manual order</option>
          <option value="due">Deadline</option>
          <option value="priority">Priority</option>
          <option value="title">Title</option>
        </select>
      </div>

      <TaskList
        :tasks="visibleTasks"
        :projects="store.projects"
        :reorderable="sortBy === 'manual'"
        focusable
        empty-message="No tasks match these filters."
      />
    </section>

    <div v-if="selected" class="mt-16 border-t border-slate-200 pt-6 dark:border-slate-800">
      <button
        class="text-xs text-slate-400 transition hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40"
        type="button"
        :disabled="store.saving"
        @click="removeProject"
      >
        Delete project and its tasks
      </button>
    </div>
  </div>
</template>
