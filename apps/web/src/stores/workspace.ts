import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../api/client'
import { collectCursorPages } from '../api/pagination'
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  EditableProjectFields,
  EditableTaskFields,
  Project,
  Task,
  TaskStatus,
} from '../api/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const projects = ref<Project[]>([])
  const tasks = ref<Task[]>([])
  const selectedProjectId = ref<string | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const selectedProject = computed(
    () => projects.value.find((project) => project.id === selectedProjectId.value) ?? null,
  )

  const selectedTasks = computed(() => {
    if (!selectedProjectId.value) return tasks.value
    return tasks.value.filter((task) => task.project_id === selectedProjectId.value)
  })

  const openTasks = computed(() => tasks.value.filter((task) => task.status !== 'completed'))
  const completedToday = computed(() => {
    const today = new Date().toDateString()
    return tasks.value.filter(
      (task) => task.completed_at && new Date(task.completed_at).toDateString() === today,
    ).length
  })

  async function bootstrap() {
    loading.value = true
    error.value = null
    try {
      await api.startDevelopmentSession()
      await refresh()
    } catch (cause) {
      error.value = messageFrom(cause)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    const [allProjects, allTasks] = await Promise.all([loadAllProjects(), loadAllTasks()])
    projects.value = allProjects
    tasks.value = sortTasks(allTasks)
    if (
      selectedProjectId.value &&
      !projects.value.some((project) => project.id === selectedProjectId.value)
    ) {
      selectedProjectId.value = null
    }
  }

  async function addProject(input: CreateProjectRequest) {
    saving.value = true
    error.value = null
    try {
      const project = await api.createProject(input)
      projects.value.unshift(project)
      selectedProjectId.value = project.id
      return project
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function editProject(project: Project, fields: EditableProjectFields) {
    saving.value = true
    error.value = null
    try {
      const updated = await api.updateProject(project.id, {
        ...fields,
        expected_version: project.version,
      })
      const index = projects.value.findIndex((candidate) => candidate.id === updated.id)
      if (index >= 0) projects.value[index] = updated
      return updated
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function removeProject(project: Project) {
    saving.value = true
    error.value = null
    try {
      await api.deleteProject(project.id, project.version)
      projects.value = projects.value.filter((candidate) => candidate.id !== project.id)
      tasks.value = tasks.value.filter((task) => task.project_id !== project.id)
      if (selectedProjectId.value === project.id) selectedProjectId.value = null
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function addTask(input: CreateTaskRequest) {
    saving.value = true
    error.value = null
    try {
      const task = await api.createTask(input)
      tasks.value = sortTasks([...tasks.value, task])
      await reloadProjectSummaries()
      return task
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function editTask(task: Task, fields: EditableTaskFields) {
    saving.value = true
    error.value = null
    try {
      const updated = await api.updateTask(task.id, {
        ...fields,
        expected_version: task.version,
      })
      if (
        task.status !== updated.status &&
        (task.status === 'completed' || updated.status === 'completed') &&
        (task.recurrence !== 'none' || updated.recurrence !== 'none')
      ) {
        tasks.value = sortTasks(await loadAllTasks())
      } else {
        replaceTask(updated)
      }
      await reloadProjectSummaries()
      return updated
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function setTaskStatus(task: Task, status: TaskStatus) {
    await editTask(task, {
      project_id: task.project_id,
      parent_task_id: task.parent_task_id ?? null,
      title: task.title,
      description: task.description,
      due_at: task.due_at ?? null,
      scheduled_start: task.scheduled_start ?? null,
      scheduled_end: task.scheduled_end ?? null,
      status,
      priority: task.priority,
      recurrence: task.recurrence,
      labels: task.labels,
      remind_at: task.remind_at ?? null,
    })
  }

  async function reorderTask(task: Task, target: Task) {
    if (task.id === target.id || saving.value) return
    const ordered = sortTasks(tasks.value)
    const sourceIndex = ordered.findIndex((candidate) => candidate.id === task.id)
    const targetIndex = ordered.findIndex((candidate) => candidate.id === target.id)
    if (sourceIndex < 0 || targetIndex < 0) return

    ;[ordered[sourceIndex], ordered[targetIndex]] = [ordered[targetIndex], ordered[sourceIndex]]
    saving.value = true
    error.value = null
    try {
      await api.reorderTasks(ordered.map((candidate) => candidate.id))
      tasks.value = ordered.map((candidate, index) => ({
        ...candidate,
        position: (index + 1) * 1024,
      }))
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function removeTask(task: Task) {
    saving.value = true
    error.value = null
    try {
      await api.deleteTask(task.id, task.version)
      tasks.value = tasks.value.filter((candidate) => candidate.id !== task.id)
      await reloadProjectSummaries()
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  function selectProject(projectId: string | null) {
    selectedProjectId.value = projectId
  }

  function clearError() {
    error.value = null
  }

  function replaceTask(updated: Task) {
    const index = tasks.value.findIndex((task) => task.id === updated.id)
    if (index >= 0) tasks.value[index] = updated
  }

  async function reloadProjectSummaries() {
    projects.value = await loadAllProjects()
  }

  return {
    projects,
    tasks,
    selectedProjectId,
    selectedProject,
    selectedTasks,
    openTasks,
    completedToday,
    loading,
    saving,
    error,
    bootstrap,
    refresh,
    addProject,
    editProject,
    removeProject,
    addTask,
    editTask,
    setTaskStatus,
    reorderTask,
    removeTask,
    selectProject,
    clearError,
  }
})

function loadAllProjects(): Promise<Project[]> {
  return collectCursorPages((cursor) => api.listProjects(cursor))
}

function loadAllTasks(): Promise<Task[]> {
  return collectCursorPages((cursor) => api.listTasks(undefined, cursor))
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((first, second) => {
    const position = Number(first.position) - Number(second.position)
    return position || first.id.localeCompare(second.id)
  })
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong'
}
