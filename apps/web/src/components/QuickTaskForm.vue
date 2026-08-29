<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { SlidersHorizontal } from '@lucide/vue'
import { useWorkspaceStore } from '../stores/workspace'
import type { TaskPriority, TaskRecurrence } from '../api/types'
import { applyDeadlineSuggestion, detectDeadlineSuggestion } from '../deadline-suggestions'

const props = withDefaults(defineProps<{ autofocus?: boolean }>(), { autofocus: false })
const emit = defineEmits<{ created: [] }>()
const store = useWorkspaceStore()
const componentId = useId()
const titleInputId = `quick-task-title-${componentId}`
const labelListId = `quick-task-labels-${componentId}`
const title = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const dueDate = ref('')
const autoDueDate = ref<string | null>(null)
const priority = ref<TaskPriority>('medium')
const projectId = ref('')
const detailsOpen = ref(false)
const description = ref('')
const recurrence = ref<TaskRecurrence>('none')
const labels = ref('')
const remindAt = ref('')

const deadlineSuggestion = computed(() =>
  !dueDate.value || autoDueDate.value ? detectDeadlineSuggestion(title.value) : null,
)
const submittedTitle = computed(() => {
  const suggestion = deadlineSuggestion.value
  return (suggestion ? applyDeadlineSuggestion(title.value, suggestion) : title.value).trim()
})
const existingLabels = computed(() =>
  [...new Set(store.tasks.flatMap((task) => task.labels))].sort((first, second) =>
    first.localeCompare(second),
  ),
)
const canSubmit = computed(
  () =>
    submittedTitle.value.length > 0 &&
    !store.saving &&
    (recurrence.value === 'none' || Boolean(dueDate.value)),
)

watch(deadlineSuggestion, (suggestion) => {
  if (suggestion) {
    if (!dueDate.value || dueDate.value === autoDueDate.value) {
      dueDate.value = suggestion.dueDate
      autoDueDate.value = suggestion.dueDate
    }
  } else if (autoDueDate.value && dueDate.value === autoDueDate.value) {
    dueDate.value = ''
    autoDueDate.value = null
  }
})

watch(
  () => [store.selectedProjectId, store.projects] as const,
  () => {
    if (store.selectedProjectId) {
      projectId.value = store.selectedProjectId
    } else if (
      projectId.value &&
      !store.projects.some((project) => project.id === projectId.value)
    ) {
      projectId.value = ''
    }
  },
  { immediate: true, deep: true },
)

function focusTitle() {
  titleInput.value?.focus()
}

defineExpose({ focusTitle })

function markDeadlineManual() {
  autoDueDate.value = null
}

async function submit() {
  if (!canSubmit.value) return

  try {
    await store.addTask({
      project_id: projectId.value || null,
      parent_task_id: null,
      title: submittedTitle.value,
      description: description.value.trim(),
      due_at: deadlineIsoDate(dueDate.value || deadlineSuggestion.value?.dueDate || ''),
      scheduled_start: null,
      scheduled_end: null,
      status: 'todo',
      priority: priority.value,
      recurrence: recurrence.value,
      labels: labels.value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      remind_at: remindAt.value ? new Date(remindAt.value).toISOString() : null,
    })
    title.value = ''
    dueDate.value = ''
    description.value = ''
    recurrence.value = 'none'
    labels.value = ''
    remindAt.value = ''
    detailsOpen.value = false
    emit('created')
  } catch {
    // The workspace error banner keeps the form populated so the user can retry.
  }
}

function deadlineIsoDate(value: string) {
  return value ? new Date(`${value}T23:59:00`).toISOString() : null
}
</script>

<template>
  <form
    class="border-y border-slate-200 py-2 dark:border-slate-800"
    @submit.prevent="submit"
    @keydown.ctrl.enter.prevent="submit"
    @keydown.meta.enter.prevent="submit"
  >
    <div class="flex items-end gap-3">
      <label class="min-w-0 flex-1" :for="titleInputId">
        <span class="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Task title
        </span>
        <input
          :id="titleInputId"
          ref="titleInput"
          v-model="title"
          class="mt-1 h-9 w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          type="text"
          maxlength="240"
          :autofocus="props.autofocus"
          placeholder="What needs to be done?"
        />
      </label>
      <button class="primary-button hidden sm:inline-flex" type="submit" :disabled="!canSubmit">
        Add
      </button>
    </div>

    <p v-if="deadlineSuggestion" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
      Deadline detected: {{ deadlineSuggestion.label }}
    </p>

    <div class="mt-1 flex flex-wrap items-center gap-2 pb-1">
      <select v-model="projectId" class="subtle-select" aria-label="Project">
        <option value="">No project</option>
        <option
          v-for="project in store.projects.filter((item) => item.status !== 'archived')"
          :key="project.id"
          :value="project.id"
        >
          {{ project.name }}
        </option>
      </select>
      <label class="subtle-control">
        <span class="sr-only">Due date</span>
        <input
          v-model="dueDate"
          class="w-[7.3rem] bg-transparent outline-none"
          type="date"
          @input="markDeadlineManual"
        />
      </label>
      <select v-model="priority" class="subtle-select" aria-label="Priority">
        <option value="low">Low priority</option>
        <option value="medium">Medium priority</option>
        <option value="high">High priority</option>
        <option value="urgent">Urgent</option>
      </select>
      <button
        class="inline-flex h-7 items-center gap-1 text-xs text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-300"
        type="button"
        :aria-expanded="detailsOpen"
        @click="detailsOpen = !detailsOpen"
      >
        <SlidersHorizontal :size="13" />
        Details
      </button>
      <button class="primary-button ml-auto sm:hidden" type="submit" :disabled="!canSubmit">
        Add
      </button>
    </div>

    <div
      v-if="detailsOpen"
      class="grid gap-3 border-t border-slate-100 py-3 dark:border-slate-900 sm:grid-cols-2"
    >
      <label class="field-label sm:col-span-2">
        Description
        <textarea
          v-model="description"
          class="field-input min-h-20 resize-y py-3"
          maxlength="10000"
          placeholder="Notes or context"
        />
      </label>
      <label class="field-label">
        Repeat
        <select v-model="recurrence" class="field-input">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label class="field-label">
        Reminder
        <input v-model="remindAt" class="field-input" type="datetime-local" />
      </label>
      <label class="field-label sm:col-span-2">
        Labels
        <input
          v-model="labels"
          class="field-input"
          :list="labelListId"
          placeholder="work, finance, errands"
        />
        <datalist :id="labelListId">
          <option v-for="label in existingLabels" :key="label" :value="label" />
        </datalist>
      </label>
      <p v-if="recurrence !== 'none' && !dueDate" class="text-xs text-rose-600 sm:col-span-2">
        Choose a deadline for repeating tasks.
      </p>
    </div>
  </form>
</template>
