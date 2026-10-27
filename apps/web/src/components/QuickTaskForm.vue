<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { SlidersHorizontal } from '@lucide/vue'
import { useWorkspaceStore } from '../stores/workspace'
import type { Task, TaskPriority, TaskRecurrence } from '../api/types'
import { analyzeQuickCapture, type QuickCaptureAnalysis } from '../quick-capture'

const props = withDefaults(
  defineProps<{
    autofocus?: boolean
    embedded?: boolean
    defaultProjectId?: string | null
    initialTask?: Pick<Task, 'title' | 'description' | 'priority' | 'labels'>
  }>(),
  { autofocus: false, embedded: false, defaultProjectId: undefined, initialTask: undefined },
)
const emit = defineEmits<{ created: [] }>()
const store = useWorkspaceStore()
const componentId = useId()
const titleInputId = `quick-task-title-${componentId}`
const labelListId = `quick-task-labels-${componentId}`
const feedbackId = `quick-task-feedback-${componentId}`
const detailsId = `quick-task-details-${componentId}`
const title = ref(props.initialTask?.title ?? '')
const saveError = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const dueDate = ref('')
const dueTime = ref('')
const manualDeadlineForTitle = ref<string | null>(null)
const autoDueDate = ref<string | null>(null)
const priority = ref<TaskPriority>(props.initialTask?.priority ?? 'medium')
const projectId = ref(props.initialTask ? (props.defaultProjectId ?? '') : '')
const detailsOpen = ref(Boolean(props.initialTask))
const description = ref(props.initialTask?.description ?? '')
const recurrence = ref<TaskRecurrence>('none')
const labels = ref(props.initialTask?.labels.join(', ') ?? '')
const remindAt = ref('')
const ignoredSmartDateForTitle = ref<string | null>(null)

const recognizesSmartDate = computed(() => ignoredSmartDateForTitle.value !== title.value)
const quickCaptureAnalysis = computed<QuickCaptureAnalysis>(() =>
  props.initialTask
    ? {
        result: {
          title: title.value.trim(),
          dueDate: null,
          scheduledStart: null,
          scheduledEnd: null,
          labels: [],
          priority: null,
          projectId: null,
        },
        temporalSuggestion: null,
      }
    : analyzeQuickCapture(title.value, new Date(), store.projects, recognizesSmartDate.value),
)
const quickCapture = computed(() => quickCaptureAnalysis.value.result)
const deadlineSuggestion = computed(() => {
  const suggestion = quickCaptureAnalysis.value.temporalSuggestion
  if (manualDeadlineForTitle.value !== title.value && (!dueDate.value || autoDueDate.value)) {
    return suggestion?.dueDate ? { ...suggestion, dueDate: suggestion.dueDate } : null
  }
  return null
})
const submittedTitle = computed(() => quickCapture.value.title)
const existingLabels = computed(() => store.labels)
const todoistHints = computed(() => {
  const hints: string[] = []
  const detectedProject = store.projects.find(
    (project) => project.id === quickCapture.value.projectId,
  )
  if (detectedProject) hints.push(`Project: ${detectedProject.name}`)
  if (quickCapture.value.labels.length) {
    hints.push(`Labels: ${quickCapture.value.labels.join(', ')}`)
  }
  if (quickCapture.value.priority) {
    hints.push(`Priority: ${quickCapture.value.priority}`)
  }
  return hints
})
const submitHint = computed(() => {
  if (store.saving) return 'Creating task…'
  if (!submittedTitle.value) return ''
  if (recurrence.value !== 'none' && !dueDate.value) return 'Choose a deadline for repeating tasks.'
  return ''
})
const canSubmit = computed(() => Boolean(submittedTitle.value) && !submitHint.value)
const detectedWorkTime = computed(() => {
  const { scheduledStart, scheduledEnd } = quickCapture.value
  if (!scheduledStart || !scheduledEnd) return ''
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `${format.format(new Date(scheduledStart))} to ${format.format(new Date(scheduledEnd))}`
})

watch(deadlineSuggestion, (suggestion) => {
  if (suggestion) {
    if (!dueDate.value || dueDate.value === autoDueDate.value) {
      dueDate.value = suggestion.dueDate
      dueTime.value = suggestion.dueTime ?? ''
      autoDueDate.value = suggestion.dueDate
    }
  } else if (autoDueDate.value && dueDate.value === autoDueDate.value) {
    dueDate.value = ''
    dueTime.value = ''
    autoDueDate.value = null
  }
})

watch(
  () => [props.defaultProjectId, store.selectedProjectId, store.projects] as const,
  () => {
    if (props.initialTask) {
      if (
        projectId.value &&
        !store.projects.some(
          (project) => project.id === projectId.value && project.status !== 'archived',
        )
      )
        projectId.value = ''
      return
    }
    const defaultProject =
      props.defaultProjectId === undefined ? store.selectedProjectId : props.defaultProjectId
    if (defaultProject) {
      projectId.value = defaultProject
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
  manualDeadlineForTitle.value = title.value
  if (!dueDate.value) dueTime.value = ''
}

function keepDetectedDateInTitle() {
  ignoredSmartDateForTitle.value = title.value
  focusTitle()
}

async function submit() {
  if (!canSubmit.value) return
  saveError.value = ''

  try {
    await store.addTask({
      project_id: quickCapture.value.projectId ?? (projectId.value || null),
      parent_task_id: null,
      title: submittedTitle.value,
      description: description.value.trim(),
      due_at: deadlineIsoDate(dueDate.value || deadlineSuggestion.value?.dueDate || ''),
      scheduled_start: quickCapture.value.scheduledStart
        ? new Date(quickCapture.value.scheduledStart).toISOString()
        : null,
      scheduled_end: quickCapture.value.scheduledEnd
        ? new Date(quickCapture.value.scheduledEnd).toISOString()
        : null,
      status: 'todo',
      priority: quickCapture.value.priority ?? priority.value,
      recurrence: recurrence.value,
      labels: [
        ...new Set([
          ...labels.value
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean),
          ...quickCapture.value.labels,
        ]),
      ],
      remind_at: remindAt.value ? new Date(remindAt.value).toISOString() : null,
    })
    title.value = ''
    dueDate.value = ''
    dueTime.value = ''
    autoDueDate.value = null
    manualDeadlineForTitle.value = null
    description.value = ''
    recurrence.value = 'none'
    labels.value = ''
    remindAt.value = ''
    detailsOpen.value = false
    emit('created')
  } catch {
    saveError.value = 'Could not create task. Your draft is kept. Try again.'
  }
}

function deadlineIsoDate(value: string) {
  return value ? new Date(`${value}T${dueTime.value || '23:59'}:00`).toISOString() : null
}
</script>

<template>
  <form
    class="min-w-0"
    :class="
      embedded
        ? ''
        : 'rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/30'
    "
    @submit.prevent="submit"
    @keydown.ctrl.enter.prevent="submit"
    @keydown.meta.enter.prevent="submit"
  >
    <div class="flex items-end gap-3">
      <label class="min-w-0 flex-1" :for="titleInputId">
        <span class="field-label"> Task title </span>
        <input
          :id="titleInputId"
          ref="titleInput"
          v-model="title"
          class="field-input"
          type="text"
          required
          :aria-describedby="feedbackId"
          maxlength="240"
          :autofocus="props.autofocus"
          placeholder="What needs to be done?"
        />
      </label>
      <button class="primary-button hidden sm:inline-flex" type="submit" :disabled="!canSubmit">
        Create task
      </button>
    </div>

    <p v-if="deadlineSuggestion" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
      Deadline detected: {{ deadlineSuggestion.dueDate }}
      {{ deadlineSuggestion.dueTime ? `at ${deadlineSuggestion.dueTime}` : '(end of day)' }}
    </p>
    <p
      v-if="detectedWorkTime"
      class="mt-1 text-xs text-slate-700 dark:text-slate-200"
      role="status"
    >
      Work time detected: {{ detectedWorkTime }} (1-hour block).
    </p>
    <p
      v-if="quickCaptureAnalysis.temporalSuggestion"
      class="mt-1 text-xs text-slate-500 dark:text-slate-400"
    >
      Dates and times above will be saved.
      <button
        class="ml-1 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
        type="button"
        :aria-label="`Keep ${quickCaptureAnalysis.temporalSuggestion.matchedText} in task title`"
        @click="keepDetectedDateInTitle"
      >
        Keep as text instead
      </button>
    </p>
    <p v-if="todoistHints.length" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
      Quick Add detected: {{ todoistHints.join(' · ') }}
    </p>

    <div class="mt-3 flex flex-wrap items-end gap-3">
      <label
        class="min-w-0 max-w-full flex-1 basis-40 text-xs text-slate-600 dark:text-slate-300 sm:w-48 sm:flex-none"
      >
        <span class="block">Project</span>
        <select v-model="projectId" class="subtle-select w-full">
          <option value="">No project</option>
          <option
            v-for="project in store.projects.filter((item) => item.status !== 'archived')"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="text-xs text-slate-600 dark:text-slate-300">
        <span class="block">Deadline</span>
        <input
          v-model="dueDate"
          class="subtle-control w-[9rem] bg-transparent outline-none"
          type="date"
          :required="recurrence !== 'none'"
          :aria-describedby="feedbackId"
          @input="markDeadlineManual"
        />
      </label>
      <label v-if="dueDate" class="text-xs text-slate-600 dark:text-slate-300">
        <span class="block">Deadline time</span>
        <input
          v-model="dueTime"
          class="subtle-control bg-transparent"
          type="time"
          @input="markDeadlineManual"
        />
        <span v-if="!dueTime" class="block">Default: end of day</span>
      </label>
      <label class="text-xs text-slate-600 dark:text-slate-300">
        <span class="block">Priority</span>
        <select v-model="priority" class="subtle-select">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <button
        class="secondary-button gap-1"
        type="button"
        :aria-expanded="detailsOpen"
        :aria-controls="detailsId"
        @click="detailsOpen = !detailsOpen"
      >
        <SlidersHorizontal :size="13" />
        Details
      </button>
      <button class="primary-button ml-auto sm:hidden" type="submit" :disabled="!canSubmit">
        Create task
      </button>
    </div>

    <p :id="feedbackId" class="text-xs text-slate-500 dark:text-slate-400" role="status">
      {{ submitHint }}
      <template v-if="!detailsOpen && recurrence !== 'none'">Repeats {{ recurrence }}.</template>
      <template v-if="!detailsOpen && remindAt">Reminder set.</template>
    </p>
    <p v-if="saveError" class="mt-2 text-sm text-rose-600 dark:text-rose-400" role="alert">
      {{ saveError }}
    </p>
    <div
      v-show="detailsOpen"
      :id="detailsId"
      class="grid grid-cols-1 gap-3 border-t border-slate-100 py-3 dark:border-slate-900 sm:grid-cols-2"
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
    </div>
  </form>
</template>
