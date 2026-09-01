import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../api/client'
import { collectCursorPages } from '../api/pagination'
import { localDateKey } from '../calendar'
import type {
  Calendar,
  CalendarEvent,
  CreateCalendarEventRequest,
  CreateCalendarRequest,
  CreateNoteRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  DailyPlan,
  DailyReview,
  EditableProjectFields,
  EditableTaskFields,
  FileRecord,
  Note,
  Project,
  ReviewTaskDecision,
  Task,
  TaskStatus,
  UpdateCalendarEventRequest,
  UpdateCalendarRequest,
  UserProfile,
  UserSettings,
} from '../api/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const projects = ref<Project[]>([])
  const tasks = ref<Task[]>([])
  const calendars = ref<Calendar[]>([])
  const events = ref<CalendarEvent[]>([])
  const notes = ref<Note[]>([])
  const files = ref<FileRecord[]>([])
  const user = ref<UserProfile | null>(null)
  const settings = ref<UserSettings | null>(null)
  const authenticationRequired = ref(false)
  const dailyPlan = ref<DailyPlan | null>(null)
  const dailyReview = ref<DailyReview | null>(null)
  const labels = ref<string[]>([])
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
      try {
        user.value = (await api.getSession()).user
      } catch (cause) {
        if (!(cause instanceof api.ApiError) || cause.status !== 401) throw cause
        try {
          user.value = (await api.startDevelopmentSession()).user
        } catch (developmentCause) {
          if (developmentCause instanceof api.ApiError && developmentCause.status === 401) {
            authenticationRequired.value = true
            return
          }
          throw developmentCause
        }
      }
      authenticationRequired.value = false
      await refresh()
    } catch (cause) {
      error.value = messageFrom(cause)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    const today = localDateKey(new Date())
    const rangeStart = new Date()
    rangeStart.setHours(0, 0, 0, 0)
    const rangeEnd = new Date(rangeStart)
    rangeEnd.setDate(rangeEnd.getDate() + 8)
    const [
      allProjects,
      allTasks,
      labelList,
      plan,
      allCalendars,
      upcomingEvents,
      allNotes,
      allFiles,
      userSettings,
    ] = await Promise.all([
      loadAllProjects(),
      loadAllTasks(),
      api.listLabels(),
      api.getDailyPlan(today),
      api.listCalendars(),
      api.listEvents(rangeEnd.toISOString(), rangeStart.toISOString()),
      api.listNotes(),
      api.listFiles(),
      api.getSettings(),
    ])
    projects.value = allProjects
    tasks.value = sortTasks(allTasks)
    labels.value = labelList.items
    dailyPlan.value = plan
    calendars.value = allCalendars
    events.value = upcomingEvents
    notes.value = allNotes
    files.value = allFiles
    settings.value = userSettings
    if (userSettings.automatic_daily_review) {
      const review = await api.startDailyReview(today)
      dailyReview.value = review?.status === 'open' ? review : null
    } else {
      dailyReview.value = null
    }
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
      await Promise.all([reloadProjectSummaries(), reloadLabels(), reloadUpcomingEvents()])
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
      await Promise.all([reloadProjectSummaries(), reloadUpcomingEvents()])
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
    if (
      status === 'completed' &&
      dailyPlan.value?.focus_tasks.some((focus) => focus.id === task.id)
    ) {
      await setDailyFocus(
        dailyPlan.value.focus_tasks
          .filter((focus) => focus.id !== task.id)
          .map((focus) => focus.id),
      )
    }
  }

  async function addFile(
    file: File,
    link: { project_id?: string; task_id?: string; note_id?: string; event_id?: string } = {},
  ) {
    const uploaded = await api.uploadFile(file, link)
    files.value = [uploaded, ...files.value]
    return uploaded
  }

  async function removeFile(file: FileRecord) {
    await api.deleteFile(file.id)
    files.value = files.value.filter((candidate) => candidate.id !== file.id)
  }

  async function addNote(input: CreateNoteRequest) {
    const note = await api.createNote(input)
    notes.value = [note, ...notes.value]
    return note
  }

  async function editNote(
    note: Note,
    title: string,
    markdown: string,
    links?: { project_id?: string; task_id?: string; event_id?: string },
  ) {
    const effectiveLinks = links ?? {
      project_id: note.project_id ?? undefined,
      task_id: note.task_id ?? undefined,
      event_id: note.event_id ?? undefined,
    }
    const updated = await api.updateNote(note.id, {
      project_id: effectiveLinks.project_id ?? null,
      task_id: effectiveLinks.task_id ?? null,
      event_id: effectiveLinks.event_id ?? null,
      title,
      markdown,
      expected_version: note.version,
    })
    const index = notes.value.findIndex((candidate) => candidate.id === note.id)
    if (index >= 0) notes.value[index] = updated
    return updated
  }

  async function removeNote(note: Note) {
    await api.deleteNote(note.id, note.version)
    notes.value = notes.value.filter((candidate) => candidate.id !== note.id)
  }

  async function loadCalendarRange(start: Date, end: Date) {
    events.value = await api.listEvents(end.toISOString(), start.toISOString())
  }

  async function addCalendar(input: CreateCalendarRequest) {
    const calendar = await api.createCalendar(input)
    calendars.value = [...calendars.value, calendar]
    return calendar
  }

  async function editCalendar(calendar: Calendar, input: UpdateCalendarRequest) {
    const updated = await api.updateCalendar(calendar.id, input)
    const index = calendars.value.findIndex((candidate) => candidate.id === calendar.id)
    if (index >= 0) calendars.value[index] = updated
    return updated
  }

  async function removeCalendar(calendar: Calendar) {
    await api.deleteCalendar(calendar.id, calendar.version)
    calendars.value = calendars.value.filter((candidate) => candidate.id !== calendar.id)
    events.value = events.value.filter((event) => event.calendar_id !== calendar.id)
  }

  async function addEvent(input: CreateCalendarEventRequest) {
    const event = await api.createEvent(input)
    events.value = [...events.value, event].sort((first, second) =>
      first.starts_at.localeCompare(second.starts_at),
    )
    return event
  }

  async function editEvent(event: CalendarEvent, input: UpdateCalendarEventRequest) {
    const updated = await api.updateEvent(event.id, input)
    const index = events.value.findIndex((candidate) => candidate.id === event.id)
    if (index >= 0) events.value[index] = updated
    return updated
  }

  async function removeEvent(event: CalendarEvent) {
    await api.deleteEvent(event.id, event.version)
    events.value = events.value.filter((candidate) => candidate.id !== event.id)
    if (event.linked_task_id) await refresh()
  }

  async function startDailyReview() {
    const review = await api.startDailyReview(localDateKey(new Date()))
    dailyReview.value = review?.status === 'open' ? review : null
    return dailyReview.value
  }

  async function completeDailyReview(decisions: ReviewTaskDecision[]) {
    if (!dailyReview.value) return
    await api.completeDailyReview(localDateKey(new Date()), decisions, dailyReview.value.version)
    dailyReview.value = null
    dailyPlan.value = await api.getDailyPlan(localDateKey(new Date()))
    tasks.value = sortTasks(await loadAllTasks())
  }

  async function setDailyFocus(taskIds: string[]) {
    dailyPlan.value = await api.updateDailyFocus(localDateKey(new Date()), taskIds)
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
      await Promise.all([reloadProjectSummaries(), reloadUpcomingEvents()])
    } catch (cause) {
      error.value = messageFrom(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function saveSettings(updated: UserSettings) {
    settings.value = await api.updateSettings(updated)
    return settings.value
  }

  async function deleteAccount() {
    await api.deleteAccount()
    user.value = null
    projects.value = []
    tasks.value = []
    calendars.value = []
    events.value = []
    notes.value = []
    files.value = []
    authenticationRequired.value = true
  }

  async function logout() {
    await api.logout()
    user.value = null
    projects.value = []
    tasks.value = []
    authenticationRequired.value = true
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

  async function reloadLabels() {
    labels.value = (await api.listLabels()).items
  }

  async function reloadUpcomingEvents() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 8)
    events.value = await api.listEvents(end.toISOString(), start.toISOString())
    calendars.value = await api.listCalendars()
  }

  return {
    projects,
    tasks,
    calendars,
    events,
    notes,
    files,
    user,
    settings,
    authenticationRequired,
    dailyPlan,
    dailyReview,
    labels,
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
    addFile,
    removeFile,
    addNote,
    editNote,
    removeNote,
    loadCalendarRange,
    addCalendar,
    editCalendar,
    removeCalendar,
    addEvent,
    editEvent,
    removeEvent,
    startDailyReview,
    completeDailyReview,
    setDailyFocus,
    reorderTask,
    removeTask,
    saveSettings,
    deleteAccount,
    logout,
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
