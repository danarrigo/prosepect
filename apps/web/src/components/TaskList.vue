<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { EditableTaskFields, Project, Task, TaskStatus } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'
import TaskItem from './TaskItem.vue'
import CreateTaskDialog from './CreateTaskDialog.vue'
import BulkTaskToolbar from './BulkTaskToolbar.vue'

const props = withDefaults(
  defineProps<{
    tasks: Task[]
    projects?: Project[]
    emptyMessage?: string
    reorderable?: boolean
    focusable?: boolean
    preserveOrder?: boolean
    bulkable?: boolean
  }>(),
  {
    projects: () => [],
    emptyMessage: '',
    reorderable: true,
    focusable: false,
    preserveOrder: false,
    bulkable: false,
  },
)

const emit = defineEmits<{ focusLost: [] }>()
const store = useWorkspaceStore()
const draggedTaskId = ref<string | null>(null)
const duplicateDialog = ref<InstanceType<typeof CreateTaskDialog> | null>(null)
const announcement = ref('')
const selecting = ref(false)
const selectionButton = ref<HTMLButtonElement | null>(null)
const listRoot = ref<HTMLElement | null>(null)
const selection = ref(new Map<string, Task>())
const selectedTasks = computed(() => [...selection.value.values()])
watch(
  () => props.tasks.map((task) => task.id),
  (ids) => {
    const visible = new Set(ids)
    selection.value = new Map([...selection.value].filter(([id]) => visible.has(id)))
  },
)
watch(
  () => store.user?.id,
  () => {
    selection.value.clear()
    selecting.value = false
  },
)
function selectTask(task: Task) {
  if (store.saving) return
  if (selection.value.has(task.id)) selection.value.delete(task.id)
  else if (selection.value.size < 50)
    selection.value.set(task.id, { ...task, labels: [...task.labels] })
}
function selectVisible() {
  if (store.saving) return
  selection.value = new Map(
    props.tasks
      .slice(0, 50)
      .map((task) => [
        task.id,
        selection.value.get(task.id) ?? { ...task, labels: [...task.labels] },
      ]),
  )
}
async function finishSelection() {
  selection.value.clear()
  selecting.value = false
  await nextTick()
  selectionButton.value?.focus()
}
async function bulkDone(savedIds: string[]) {
  for (const id of savedIds) selection.value.delete(id)
  await nextTick()
  listRoot.value?.querySelector<HTMLElement>('[aria-label="Bulk task actions"] button')?.focus()
}
const rows = computed(() => flattenTasks(props.tasks))
const focusTaskIds = computed(() =>
  store.dailyPlan ? store.dailyPlan.focus_tasks.map((task) => task.id) : [],
)

async function restoreFilteredFocus(focused: Element | null) {
  await nextTick()
  if (focused && !focused.isConnected && document.activeElement === document.body) emit('focusLost')
}

async function changeStatus(task: Task, status: TaskStatus) {
  const focused = document.activeElement
  try {
    await store.setTaskStatus(task, status)
    await restoreFilteredFocus(focused)
  } catch {
    // The store presents the API error globally.
  }
}

async function edit(task: Task, fields: EditableTaskFields) {
  const focused = document.activeElement
  try {
    await store.editTask(task, fields)
    await restoreFilteredFocus(focused)
  } catch {
    // The store presents the API error globally.
  }
}

async function remove(task: Task) {
  if (!window.confirm(`Delete “${task.title}”?`)) return
  const focused = document.activeElement
  try {
    const deleted = await store.removeTask(task)
    await nextTick()
    if (deleted && focused && !focused.isConnected && document.activeElement === document.body)
      document.getElementById('task-deletion-feedback')?.focus()
  } catch {
    // The store presents the API error globally.
  }
}

async function addSubtask(parent: Task, title: string) {
  try {
    await store.addTask({
      project_id: parent.project_id,
      parent_task_id: parent.id,
      title,
      description: '',
      due_at: null,
      scheduled_start: null,
      scheduled_end: null,
      status: 'todo',
      priority: parent.priority,
      recurrence: 'none',
      labels: parent.labels,
      remind_at: null,
    })
  } catch {
    // The store presents the API error globally.
  }
}

async function toggleFocus(task: Task) {
  const focused = focusTaskIds.value.includes(task.id)
  if (!focused && focusTaskIds.value.length >= 3) return
  try {
    await store.setDailyFocus(
      focused
        ? focusTaskIds.value.filter((taskId) => taskId !== task.id)
        : [...focusTaskIds.value, task.id],
    )
  } catch {
    // The store presents the API error globally.
  }
}

async function move(task: Task, direction: 'up' | 'down') {
  const index = rows.value.findIndex((row) => row.task.id === task.id)
  const target = rows.value[index + (direction === 'up' ? -1 : 1)]?.task
  if (!target) return
  await reorder(task, target)
}

function beginDrag(task: Task, event: DragEvent) {
  draggedTaskId.value = task.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
  }
}

async function dropOn(target: Task) {
  const source = store.tasks.find((task) => task.id === draggedTaskId.value)
  draggedTaskId.value = null
  if (!source || source.id === target.id) return
  await reorder(source, target)
}

async function reorder(task: Task, target: Task) {
  try {
    await store.reorderTask(task, target)
    announcement.value = `Moved ${task.title} to the position of ${target.title}`
  } catch {
    // The store presents the API error globally.
  }
}

function flattenTasks(tasks: Task[]): Array<{ task: Task; depth: number }> {
  const sorted = props.preserveOrder
    ? [...tasks]
    : [...tasks].sort((first, second) => Number(first.position) - Number(second.position))
  const included = new Set(sorted.map((task) => task.id))
  const children = new Map<string, Task[]>()
  for (const task of sorted) {
    if (!task.parent_task_id || !included.has(task.parent_task_id)) continue
    const siblings = children.get(task.parent_task_id) ?? []
    siblings.push(task)
    children.set(task.parent_task_id, siblings)
  }

  const rows: Array<{ task: Task; depth: number }> = []
  const visited = new Set<string>()
  function append(task: Task, depth: number) {
    if (visited.has(task.id)) return
    visited.add(task.id)
    rows.push({ task, depth })
    for (const child of children.get(task.id) ?? []) append(child, Math.min(depth + 1, 4))
  }

  for (const task of sorted) {
    if (!task.parent_task_id || !included.has(task.parent_task_id)) append(task, 0)
  }
  for (const task of sorted) append(task, 0)
  return rows
}
</script>

<template>
  <div ref="listRoot">
    <div v-if="bulkable" class="mb-3 flex flex-wrap gap-2">
      <button
        v-if="!selecting"
        ref="selectionButton"
        type="button"
        class="secondary-button"
        :disabled="store.saving || !rows.length"
        @click="selecting = true"
      >
        Select tasks
      </button>
      <button
        v-if="selecting"
        type="button"
        class="secondary-button"
        :disabled="store.saving || !rows.length"
        @click="selectVisible"
      >
        Select visible (up to 50)
      </button>
    </div>
    <BulkTaskToolbar
      v-if="bulkable && selecting"
      :selected="selectedTasks"
      :projects="projects"
      @done="bulkDone"
      @cancel="finishSelection"
    />
    <div
      v-for="(row, index) in rows"
      :key="row.task.id"
      :data-task-id="row.task.id"
      :draggable="reorderable && !selecting && !store.saving"
      class="@container/task flex items-start gap-2 transition-opacity"
      :class="{ 'opacity-40': draggedTaskId === row.task.id }"
      :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
      @dragstart="beginDrag(row.task, $event)"
      @dragend="draggedTaskId = null"
      @dragover.prevent
      @drop.prevent="dropOn(row.task)"
    >
      <label v-if="bulkable && selecting" class="mt-2 grid size-11 shrink-0 place-items-center">
        <input
          type="checkbox"
          class="size-4 accent-slate-900 dark:accent-white"
          :aria-label="`Select ${row.task.title}`"
          :checked="selection.has(row.task.id)"
          :disabled="store.saving || (!selection.has(row.task.id) && selection.size >= 50)"
          @change="selectTask(row.task)"
        />
      </label>
      <TaskItem
        class="min-w-0 flex-1"
        :task="row.task"
        :projects="projects"
        :tasks="store.tasks"
        :busy="store.saving || selecting"
        :can-move-up="reorderable && index > 0"
        :can-move-down="reorderable && index < rows.length - 1"
        :focusable="focusable && row.task.status !== 'completed'"
        :focused="focusTaskIds.includes(row.task.id)"
        :focus-disabled="focusTaskIds.length >= 3 && !focusTaskIds.includes(row.task.id)"
        @status="changeStatus"
        @edit="edit"
        @remove="remove"
        @duplicate="duplicateDialog?.open($event)"
        @add-subtask="addSubtask"
        @move="move"
        @focus="toggleFocus"
      />
    </div>
    <p
      v-if="!rows.length && emptyMessage"
      class="py-14 text-center text-sm text-slate-500 dark:text-slate-400"
    >
      {{ emptyMessage }}
    </p>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <CreateTaskDialog ref="duplicateDialog" />
  </div>
</template>
