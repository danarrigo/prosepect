<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project, Task, TaskPriority } from '../api/types'
import type { BulkTaskAction } from '../bulk-tasks'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{ selected: Task[]; projects: Project[] }>()
const emit = defineEmits<{ done: [savedIds: string[]]; cancel: [] }>()
const store = useWorkspaceStore()
const kind = ref<BulkTaskAction['kind']>('complete')
const priority = ref<TaskPriority>('medium')
const projectId = ref('')
const label = ref('')
const availableProjects = computed(() =>
  props.projects.filter((project) => project.status !== 'archived'),
)
const failures = computed(() =>
  store.bulkTaskResults.filter((result) => result.outcome === 'unconfirmed'),
)
const saved = computed(
  () => store.bulkTaskResults.filter((result) => result.outcome === 'saved').length,
)
const invalid = computed(
  () =>
    !props.selected.length ||
    props.selected.length > 50 ||
    (kind.value === 'label' && !label.value.trim()) ||
    (kind.value === 'project' &&
      projectId.value !== '' &&
      !availableProjects.value.some((project) => project.id === projectId.value)),
)

async function apply() {
  if (invalid.value || store.saving) return
  if (
    kind.value === 'delete' &&
    !window.confirm(
      `Delete ${props.selected.length} selected tasks? Linked content is also removed. Undo is available briefly for each saved deletion. Tasks with subtasks cannot be deleted until their subtasks are removed.`,
    )
  )
    return
  const action: BulkTaskAction =
    kind.value === 'project'
      ? { kind: 'project', projectId: projectId.value || null }
      : kind.value === 'priority'
        ? { kind: 'priority', priority: priority.value }
        : kind.value === 'label'
          ? { kind: 'label', label: label.value.trim() }
          : { kind: kind.value }
  await store.applyBulkTaskAction(props.selected, action)
  emit(
    'done',
    store.bulkTaskResults.filter((result) => result.outcome === 'saved').map((result) => result.id),
  )
}
</script>

<template>
  <section
    aria-label="Bulk task actions"
    class="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium">
        {{ selected.length }} selected <span class="font-normal text-slate-500">(up to 50)</span>
      </p>
      <button
        type="button"
        class="secondary-button"
        :disabled="store.saving"
        @click="emit('cancel')"
      >
        Done selecting
      </button>
    </div>
    <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="apply">
      <label class="min-w-0 flex-1 text-sm"
        >Action
        <select v-model="kind" class="field-input mt-1 w-full" :disabled="store.saving">
          <option value="complete">Complete</option>
          <option value="project">Move to project</option>
          <option value="priority">Set priority</option>
          <option value="label">Add label</option>
          <option value="delete">Delete</option>
        </select>
      </label>
      <label v-if="kind === 'project'" class="min-w-0 flex-1 text-sm"
        >Destination project
        <select v-model="projectId" class="field-input mt-1 w-full" :disabled="store.saving">
          <option value="">No project</option>
          <option v-for="project in availableProjects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label v-if="kind === 'priority'" class="min-w-0 flex-1 text-sm"
        >Priority
        <select v-model="priority" class="field-input mt-1 w-full" :disabled="store.saving">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <label v-if="kind === 'label'" class="min-w-0 flex-1 text-sm"
        >Label
        <input
          v-model="label"
          class="field-input mt-1 w-full"
          maxlength="80"
          :disabled="store.saving"
        />
      </label>
      <button
        type="submit"
        class="primary-button sm:col-span-2 sm:justify-self-start"
        :disabled="store.saving || invalid"
      >
        {{ store.bulkTaskPending ? 'Applying…' : 'Apply to selected' }}
      </button>
    </form>
    <p class="mt-2 text-xs text-slate-500">
      Only selected tasks change. Parent relationships and repeat settings are preserved; hierarchy
      restrictions still apply.
    </p>
    <div role="status" aria-live="polite" class="mt-2 text-sm">
      <p v-if="!store.bulkTaskPending && store.bulkTaskResults.length">
        {{ saved }} saved. {{ failures.length }} not confirmed.
      </p>
      <p v-if="!store.bulkTaskPending && failures.length">
        Reload and review these tasks before trying again. Successful changes are not rolled back.
      </p>
      <ul
        v-if="!store.bulkTaskPending && failures.length"
        class="mt-1 list-inside list-disc break-words"
      >
        <li v-for="failure in failures" :key="failure.id">
          {{ failure.title }}: {{ failure.message }}
        </li>
      </ul>
      <p v-if="store.bulkTaskRefreshError">{{ store.bulkTaskRefreshError }}</p>
    </div>
  </section>
</template>
