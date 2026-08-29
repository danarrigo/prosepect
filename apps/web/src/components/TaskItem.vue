<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarClock,
  Check,
  Circle,
  GripVertical,
  ListTree,
  Pencil,
  Repeat2,
  Trash2,
  X,
} from '@lucide/vue'
import type {
  EditableTaskFields,
  Project,
  Task,
  TaskPriority,
  TaskRecurrence,
  TaskStatus,
} from '../api/types'
import { localDateKey } from '../calendar'
import { applyDeadlineSuggestion, detectDeadlineSuggestion } from '../deadline-suggestions'

const props = withDefaults(
  defineProps<{
    task: Task
    projects?: Project[]
    tasks?: Task[]
    busy?: boolean
    canMoveUp?: boolean
    canMoveDown?: boolean
  }>(),
  { projects: () => [], tasks: () => [], busy: false, canMoveUp: false, canMoveDown: false },
)
const emit = defineEmits<{
  status: [task: Task, status: TaskStatus]
  edit: [task: Task, fields: EditableTaskFields]
  remove: [task: Task]
  addSubtask: [task: Task, title: string]
  move: [task: Task, direction: 'up' | 'down']
}>()

const labelListId = `task-labels-${useId()}`
const editing = ref(false)
const addingSubtask = ref(false)
const submittedVersion = ref<number | null>(null)
const title = ref('')
const description = ref('')
const projectId = ref('')
const parentTaskId = ref('')
const dueDate = ref('')
const autoDueDate = ref<string | null>(null)
const priority = ref<TaskPriority>('medium')
const status = ref<TaskStatus>('todo')
const recurrence = ref<TaskRecurrence>('none')
const labels = ref('')
const remindAt = ref('')
const subtaskTitle = ref('')

const completed = computed(() => props.task.status === 'completed')
const hasSubtasks = computed(() =>
  props.tasks.some((task) => task.parent_task_id === props.task.id),
)
const existingLabels = computed(() =>
  [...new Set(props.tasks.flatMap((task) => task.labels))].sort((first, second) =>
    first.localeCompare(second),
  ),
)
const parentOptions = computed(() =>
  props.tasks.filter(
    (task) =>
      task.id !== props.task.id &&
      task.project_id === (projectId.value || null) &&
      !task.parent_task_id,
  ),
)
const dueLabel = computed(() => {
  if (!props.task.due_at) return null
  const date = new Date(props.task.due_at)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
})
const reminderLabel = computed(() => {
  if (!props.task.remind_at || completed.value) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(props.task.remind_at))
})
const overdue = computed(() =>
  Boolean(props.task.due_at && !completed.value && new Date(props.task.due_at) < new Date()),
)
const deadlineSuggestion = computed(() =>
  editing.value && (!dueDate.value || autoDueDate.value)
    ? detectDeadlineSuggestion(title.value)
    : null,
)
const editedTitle = computed(() => {
  const suggestion = deadlineSuggestion.value
  return (suggestion ? applyDeadlineSuggestion(title.value, suggestion) : title.value).trim()
})
const canSave = computed(
  () => editedTitle.value && !props.busy && (recurrence.value === 'none' || dueDate.value),
)

watch(deadlineSuggestion, (suggestion) => {
  if (!editing.value) return
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

watch(projectId, () => {
  if (
    parentTaskId.value &&
    !parentOptions.value.some((candidate) => candidate.id === parentTaskId.value)
  ) {
    parentTaskId.value = ''
  }
})

watch(parentTaskId, (value) => {
  if (value) recurrence.value = 'none'
})

watch(
  () => props.task.version,
  (version) => {
    if (submittedVersion.value !== null && version > submittedVersion.value) {
      submittedVersion.value = null
      editing.value = false
      populateEditor()
    } else if (!editing.value) {
      populateEditor()
    }
  },
  { immediate: true },
)

function populateEditor() {
  title.value = props.task.title
  description.value = props.task.description
  projectId.value = props.task.project_id ?? ''
  parentTaskId.value = props.task.parent_task_id ?? ''
  dueDate.value = props.task.due_at ? localDateKey(new Date(props.task.due_at)) : ''
  priority.value = props.task.priority
  status.value = props.task.status
  recurrence.value = props.task.recurrence
  labels.value = props.task.labels.join(', ')
  remindAt.value = props.task.remind_at ? localDateTimeValue(props.task.remind_at) : ''
}

function beginEditing() {
  populateEditor()
  submittedVersion.value = null
  autoDueDate.value = null
  addingSubtask.value = false
  editing.value = true
}

function cancelEditing() {
  submittedVersion.value = null
  autoDueDate.value = null
  editing.value = false
  populateEditor()
}

function markDeadlineManual() {
  autoDueDate.value = null
}

function submitEdit() {
  if (!canSave.value) return
  submittedVersion.value = props.task.version
  emit('edit', props.task, editableFields())
}

function editableFields(): EditableTaskFields {
  return {
    project_id: projectId.value || null,
    parent_task_id: parentTaskId.value || null,
    title: editedTitle.value,
    description: description.value.trim(),
    due_at: editedDueAt(dueDate.value || deadlineSuggestion.value?.dueDate || ''),
    scheduled_start: props.task.scheduled_start ?? null,
    scheduled_end: props.task.scheduled_end ?? null,
    status: status.value,
    priority: priority.value,
    recurrence: recurrence.value,
    labels: labels.value
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
    remind_at: remindAt.value ? new Date(remindAt.value).toISOString() : null,
  }
}

function editedDueAt(value: string) {
  if (!value) return null
  if (props.task.due_at && localDateKey(new Date(props.task.due_at)) === value) {
    return props.task.due_at
  }
  return new Date(`${value}T23:59:00`).toISOString()
}

function localDateTimeValue(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toggle() {
  emit('status', props.task, completed.value ? 'todo' : 'completed')
}

function submitSubtask() {
  const value = subtaskTitle.value.trim()
  if (!value || props.busy) return
  emit('addSubtask', props.task, value)
  subtaskTitle.value = ''
  addingSubtask.value = false
}
</script>

<template>
  <article
    v-if="!editing"
    class="group flex min-h-14 w-full min-w-0 items-center gap-2 border-b border-slate-100 py-2 dark:border-slate-900"
  >
    <GripVertical
      :size="14"
      class="hidden shrink-0 text-slate-300 group-hover:text-slate-500 sm:block"
      aria-hidden="true"
    />
    <button
      class="grid size-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:hover:text-white"
      type="button"
      :disabled="busy"
      :aria-label="completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`"
      @click="toggle"
    >
      <span
        v-if="completed"
        class="grid size-5 place-items-center rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950"
      >
        <Check :size="13" :stroke-width="3" />
      </span>
      <Circle v-else :size="21" />
    </button>

    <div class="min-w-0 flex-1">
      <p
        class="truncate text-sm font-medium text-slate-800 dark:text-slate-200"
        :class="{ 'text-slate-400 line-through dark:text-slate-600': completed }"
      >
        {{ task.title }}
      </p>
      <p v-if="task.description" class="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
        {{ task.description }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span class="priority-dot" :class="`priority-${task.priority}`" />
        <span class="capitalize">{{ task.priority }}</span>
        <span
          v-if="task.status === 'blocked'"
          class="font-medium text-amber-700 dark:text-amber-400"
        >
          Blocked
        </span>
        <span
          v-else-if="task.status === 'in_progress'"
          class="font-medium text-slate-600 dark:text-slate-300"
        >
          In progress
        </span>
        <span
          v-if="dueLabel"
          class="inline-flex items-center gap-1"
          :class="{ 'font-medium text-rose-600 dark:text-rose-400': overdue }"
        >
          <CalendarClock :size="12" />
          {{ dueLabel }}
        </span>
        <span v-if="task.recurrence !== 'none'" class="inline-flex items-center gap-1 capitalize">
          <Repeat2 :size="12" />
          {{ task.recurrence }}
        </span>
        <span v-if="reminderLabel" class="inline-flex items-center gap-1">
          <Bell :size="12" />
          {{ reminderLabel }}
        </span>
        <span
          v-for="label in task.labels"
          :key="label"
          class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
        >
          {{ label }}
        </span>
      </div>

      <form v-if="addingSubtask" class="mt-3 flex gap-2" @submit.prevent="submitSubtask">
        <input
          v-model="subtaskTitle"
          class="h-8 min-w-0 flex-1 border-b border-slate-200 bg-transparent text-xs outline-none focus:border-slate-400 dark:border-slate-800"
          maxlength="240"
          placeholder="Subtask title"
          autofocus
        />
        <button class="secondary-button !min-h-8 !px-2.5 !text-xs" type="submit">Add</button>
        <button
          class="icon-button !size-8"
          type="button"
          aria-label="Cancel adding subtask"
          @click="addingSubtask = false"
        >
          <X :size="14" />
        </button>
      </form>
    </div>

    <select
      class="hidden max-w-28 border-0 bg-transparent px-1 py-1 text-xs text-slate-500 outline-none transition focus:opacity-100 focus-visible:ring-2 focus-visible:ring-slate-400 2xl:block 2xl:opacity-0 2xl:group-hover:opacity-100"
      :value="task.status"
      :disabled="busy"
      :aria-label="`Status for ${task.title}`"
      @change="emit('status', task, ($event.target as HTMLSelectElement).value as TaskStatus)"
    >
      <option value="todo">To do</option>
      <option value="in_progress">In progress</option>
      <option value="blocked">Blocked</option>
      <option value="completed">Completed</option>
    </select>

    <div
      class="hidden items-center 2xl:flex 2xl:invisible 2xl:group-hover:visible 2xl:focus-within:visible"
    >
      <button
        class="icon-button !size-7"
        type="button"
        :disabled="busy || !canMoveUp"
        :aria-label="`Move ${task.title} up`"
        @click="emit('move', task, 'up')"
      >
        <ArrowUp :size="13" />
      </button>
      <button
        class="icon-button !size-7"
        type="button"
        :disabled="busy || !canMoveDown"
        :aria-label="`Move ${task.title} down`"
        @click="emit('move', task, 'down')"
      >
        <ArrowDown :size="13" />
      </button>
    </div>
    <button
      class="icon-button text-slate-400"
      type="button"
      :disabled="busy || task.recurrence !== 'none'"
      :aria-label="`Add subtask to ${task.title}`"
      :title="task.recurrence !== 'none' ? 'Recurring tasks cannot have subtasks' : undefined"
      @click="addingSubtask = !addingSubtask"
    >
      <ListTree :size="14" />
    </button>
    <button
      class="icon-button text-slate-400"
      type="button"
      :disabled="busy"
      :aria-label="`Edit ${task.title}`"
      @click="beginEditing"
    >
      <Pencil :size="14" />
    </button>
    <button
      class="icon-button hidden text-slate-400 hover:!text-rose-600 2xl:inline-grid 2xl:invisible 2xl:group-hover:visible 2xl:focus-visible:visible"
      type="button"
      :disabled="busy"
      :aria-label="`Delete ${task.title}`"
      @click="emit('remove', task)"
    >
      <Trash2 :size="15" />
    </button>
  </article>

  <form
    v-else
    class="border-b border-slate-200 py-4 dark:border-slate-800"
    :aria-label="`Edit ${task.title}`"
    @submit.prevent="submitEdit"
  >
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="field-label sm:col-span-2">
        Task title
        <input v-model="title" class="field-input" maxlength="240" required autofocus />
      </label>
      <p
        v-if="deadlineSuggestion"
        class="-mt-2 text-xs text-slate-500 sm:col-span-2 dark:text-slate-400"
      >
        Deadline detected: {{ deadlineSuggestion.label }}
      </p>
      <label class="field-label sm:col-span-2">
        Description
        <textarea
          v-model="description"
          class="field-input min-h-24 resize-y py-3"
          maxlength="10000"
          placeholder="Notes, context, or acceptance criteria"
        />
      </label>
      <label class="field-label">
        Project
        <select v-model="projectId" class="field-input" aria-label="Edit project">
          <option value="">No project</option>
          <option
            v-for="project in projects.filter(
              (item) => item.status !== 'archived' || item.id === task.project_id,
            )"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="field-label">
        Parent task
        <select
          v-model="parentTaskId"
          class="field-input"
          aria-label="Edit parent task"
          :disabled="recurrence !== 'none'"
        >
          <option value="">No parent</option>
          <option v-for="candidate in parentOptions" :key="candidate.id" :value="candidate.id">
            {{ candidate.title }}
          </option>
        </select>
      </label>
      <label class="field-label">
        Deadline
        <input v-model="dueDate" class="field-input" type="date" @input="markDeadlineManual" />
      </label>
      <label class="field-label">
        Reminder
        <input v-model="remindAt" class="field-input" type="datetime-local" />
      </label>
      <label class="field-label">
        Priority
        <select v-model="priority" class="field-input" aria-label="Edit priority">
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <label class="field-label">
        Status
        <select v-model="status" class="field-input" aria-label="Edit status">
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      <label class="field-label">
        Repeat
        <select
          v-model="recurrence"
          class="field-input"
          :disabled="Boolean(parentTaskId) || (hasSubtasks && task.recurrence === 'none')"
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label class="field-label">
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
    <p v-if="recurrence !== 'none' && !dueDate" class="mt-3 text-xs text-rose-600">
      Repeating tasks need a deadline.
    </p>

    <div class="mt-5 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <button
          class="icon-button !size-7"
          type="button"
          :disabled="busy || !canMoveUp"
          :aria-label="`Move ${task.title} up`"
          @click="emit('move', task, 'up')"
        >
          <ArrowUp :size="13" />
        </button>
        <button
          class="icon-button !size-7"
          type="button"
          :disabled="busy || !canMoveDown"
          :aria-label="`Move ${task.title} down`"
          @click="emit('move', task, 'down')"
        >
          <ArrowDown :size="13" />
        </button>
        <button
          class="ml-1 text-xs text-rose-500 transition hover:text-rose-700"
          type="button"
          :disabled="busy"
          @click="emit('remove', task)"
        >
          Delete
        </button>
      </div>
      <div class="ml-auto flex gap-2">
        <button class="secondary-button" type="button" :disabled="busy" @click="cancelEditing">
          Cancel
        </button>
        <button class="primary-button" type="submit" :disabled="!canSave">Save</button>
      </div>
    </div>
  </form>
</template>
