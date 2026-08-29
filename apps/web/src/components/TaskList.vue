<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditableTaskFields, Project, Task, TaskStatus } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'
import TaskItem from './TaskItem.vue'

const props = withDefaults(
  defineProps<{
    tasks: Task[]
    projects?: Project[]
    emptyMessage?: string
    reorderable?: boolean
  }>(),
  { projects: () => [], emptyMessage: '', reorderable: true },
)

const store = useWorkspaceStore()
const draggedTaskId = ref<string | null>(null)
const announcement = ref('')
const rows = computed(() => flattenTasks(props.tasks))

async function changeStatus(task: Task, status: TaskStatus) {
  try {
    await store.setTaskStatus(task, status)
  } catch {
    // The store presents the API error globally.
  }
}

async function edit(task: Task, fields: EditableTaskFields) {
  try {
    await store.editTask(task, fields)
  } catch {
    // The store presents the API error globally.
  }
}

async function remove(task: Task) {
  if (!window.confirm(`Delete “${task.title}”?`)) return
  try {
    await store.removeTask(task)
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
  const sorted = [...tasks].sort(
    (first, second) => Number(first.position) - Number(second.position),
  )
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
  <div>
    <div
      v-for="(row, index) in rows"
      :key="row.task.id"
      :data-task-id="row.task.id"
      :draggable="reorderable && !store.saving"
      class="transition-opacity"
      :class="{ 'opacity-40': draggedTaskId === row.task.id }"
      :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
      @dragstart="beginDrag(row.task, $event)"
      @dragend="draggedTaskId = null"
      @dragover.prevent
      @drop.prevent="dropOn(row.task)"
    >
      <TaskItem
        :task="row.task"
        :projects="projects"
        :tasks="store.tasks"
        :busy="store.saving"
        :can-move-up="reorderable && index > 0"
        :can-move-down="reorderable && index < rows.length - 1"
        @status="changeStatus"
        @edit="edit"
        @remove="remove"
        @add-subtask="addSubtask"
        @move="move"
      />
    </div>
    <p v-if="!rows.length && emptyMessage" class="py-14 text-center text-sm text-slate-400">
      {{ emptyMessage }}
    </p>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
