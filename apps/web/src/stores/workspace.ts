import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../api/client'
import { getOperationsCapability } from '../api/client'
import { collectCursorPages } from '../api/pagination'
import { localDateKey } from '../calendar'
import { fileUploadError } from '../file-usage'
import type {
  Calendar,
  CalendarEvent,
  CalendarMoveUndo,
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
  FileUsage,
  Note,
  Project,
  ReviewTaskDecision,
  Task,
  TaskStatus,
  TaskDeleteUndo,
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
  const fileUsage = ref<FileUsage | null>(null)
  const fileUsageLoading = ref(false)
  const fileUsageError = ref('')
  let usageRequest: Promise<void> | null = null
  let usageGeneration = 0
  const user = ref<UserProfile | null>(null)
  const operationsAllowed = ref(false)
  let capabilityGeneration = 0
  const settings = ref<UserSettings | null>(null)
  const authenticationRequired = ref(false)
  const dailyPlan = ref<DailyPlan | null>(null)
  const dailyReview = ref<DailyReview | null>(null)
  const labels = ref<string[]>([])
  const selectedProjectId = ref<string | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const calendarMoveUndo = ref<CalendarMoveUndo | null>(null)
  const calendarMovePending = ref(false)
  const calendarMoveUndoing = ref(false)
  const calendarMoveMessage = ref('')
  const calendarMoveError = ref('')
  const taskDeleteUndos = ref<TaskDeleteUndo[]>([])
  const taskDeletePending = ref(false)
  const taskDeleteMessage = ref('')
  const taskDeleteError = ref('')
  let accountGeneration = 0
  let mutationGeneration = 0
  let workspaceReadGeneration = 0
  let receiptReadGeneration = 0
  let taskDeleteGeneration = 0
  let bootstrapGeneration = 0
  let sessionRequest: AbortController | null = null
  let calendarRange: { start: Date; end: Date } | null = null
  let calendarMoveGeneration = 0
  let calendarReadGeneration = 0
  let calendarDataGeneration = 0
  // Never apply a background snapshot over local writes or another completed read.
  watch(
    [tasks, events, calendars, saving],
    () => {
      calendarDataGeneration += 1
    },
    { deep: true, flush: 'sync' },
  )
  watch(
    saving,
    (pending) => {
      if (pending) {
        mutationGeneration += 1
        calendarReadGeneration += 1
        workspaceReadGeneration += 1
      }
    },
    { flush: 'sync' },
  )
  watch(
    () => user.value?.id,
    () => {
      accountGeneration += 1
      sessionRequest?.abort()
      sessionRequest = null
      workspaceReadGeneration += 1
      receiptReadGeneration += 1
      taskDeleteGeneration += 1
      taskDeleteUndos.value = []
      taskDeleteMessage.value = ''
      taskDeleteError.value = ''
      taskDeletePending.value = false
      projects.value = []
      tasks.value = []
      calendars.value = []
      events.value = []
      notes.value = []
      files.value = []
      labels.value = []
      dailyPlan.value = null
      dailyReview.value = null
      settings.value = null
      selectedProjectId.value = null
      operationsAllowed.value = false
      error.value = null
      if (!user.value) loading.value = false
      saving.value = false
      resetFileUsage()
      calendarMoveGeneration += 1
      calendarReadGeneration += 1
      calendarMoveUndo.value = null
      calendarMoveMessage.value = ''
      calendarMoveError.value = ''
      if (calendarMovePending.value) saving.value = false
      calendarMovePending.value = false
      calendarMoveUndoing.value = false
      calendarRange = null
    },
    { flush: 'sync' },
  )

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
    sessionRequest?.abort()
    const sessionController = new AbortController()
    sessionRequest = sessionController
    const bootstrap = ++bootstrapGeneration
    const initialAccount = accountGeneration
    let bootstrapAccount = initialAccount
    let bootstrapMutation = mutationGeneration
    const generation = ++capabilityGeneration
    loading.value = true
    operationsAllowed.value = false
    error.value = null
    try {
      try {
        const session = await api.getSession(sessionController.signal)
        if (bootstrap !== bootstrapGeneration || initialAccount !== accountGeneration) return
        user.value = session.user
      } catch (cause) {
        if (bootstrap !== bootstrapGeneration || initialAccount !== accountGeneration) return
        if (!(cause instanceof api.ApiError) || cause.status !== 401) throw cause
        try {
          const session = await api.startDevelopmentSession(sessionController.signal)
          if (bootstrap !== bootstrapGeneration || initialAccount !== accountGeneration) return
          user.value = session.user
        } catch (developmentCause) {
          if (bootstrap !== bootstrapGeneration || initialAccount !== accountGeneration) return
          if (developmentCause instanceof api.ApiError && developmentCause.status === 401) {
            authenticationRequired.value = true
            return
          }
          throw developmentCause
        }
      }
      bootstrapAccount = accountGeneration
      authenticationRequired.value = false
      const accountId = user.value?.id
      const account = accountGeneration
      void getOperationsCapability(AbortSignal.timeout(10_000))
        .catch(() => false)
        .then((allowed) => {
          if (
            generation === capabilityGeneration &&
            account === accountGeneration &&
            user.value?.id === accountId
          ) {
            operationsAllowed.value = allowed === true
          }
        })
      bootstrapMutation = mutationGeneration
      await Promise.all([refresh(), recoverCalendarMoveUndo(), recoverTaskDeleteUndos()])
    } catch (cause) {
      if (
        bootstrap === bootstrapGeneration &&
        bootstrapAccount === accountGeneration &&
        bootstrapMutation === mutationGeneration
      )
        error.value = messageFrom(cause)
    } finally {
      if (sessionRequest === sessionController) sessionRequest = null
      if (bootstrap === bootstrapGeneration) loading.value = false
    }
  }

  async function refresh() {
    const account = accountGeneration
    const mutation = mutationGeneration
    const read = ++workspaceReadGeneration
    const calendarRead = calendarReadGeneration
    const current = () =>
      account === accountGeneration &&
      mutation === mutationGeneration &&
      read === workspaceReadGeneration
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
    if (!current()) return
    projects.value = allProjects
    tasks.value = sortTasks(allTasks)
    labels.value = labelList.items
    dailyPlan.value = plan
    calendars.value = allCalendars
    if (calendarRead === calendarReadGeneration) events.value = upcomingEvents
    notes.value = allNotes
    files.value = allFiles
    settings.value = userSettings
    if (userSettings.automatic_daily_review) {
      const review = await api.startDailyReview(today)
      if (current()) dailyReview.value = review?.status === 'open' ? review : null
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

  async function refreshFileUsage() {
    if (usageRequest) return usageRequest
    const generation = usageGeneration
    fileUsageLoading.value = true
    fileUsageError.value = ''
    usageRequest = (async () => {
      try {
        const usage = await api.getFileUsage()
        if (generation === usageGeneration) fileUsage.value = usage
      } catch {
        if (generation === usageGeneration) {
          fileUsage.value = null
          fileUsageError.value = 'Could not load attachment limits. Retry before uploading.'
        }
      } finally {
        if (generation === usageGeneration) {
          fileUsageLoading.value = false
          usageRequest = null
        }
      }
    })()
    return usageRequest
  }

  async function addFile(
    file: File,
    link: { project_id?: string; task_id?: string; note_id?: string; event_id?: string } = {},
  ) {
    await refreshFileUsage()
    if (!fileUsage.value) throw new Error(fileUsageError.value)
    const validationError = fileUploadError(file.size, fileUsage.value)
    if (validationError) throw new Error(validationError)
    try {
      const uploaded = await api.uploadFile(file, link)
      files.value = [uploaded, ...files.value]
      return uploaded
    } finally {
      await refreshFileUsage()
    }
  }

  async function removeFile(file: FileRecord) {
    try {
      await api.deleteFile(file.id)
      files.value = files.value.filter((candidate) => candidate.id !== file.id)
    } finally {
      await refreshFileUsage()
    }
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

  async function loadCalendarRange(start: Date, end: Date, signal?: AbortSignal) {
    const range = { start, end }
    const account = user.value?.id
    const generation = ++calendarReadGeneration
    const mutation = mutationGeneration
    calendarRange = range
    const result = await api.listEvents(end.toISOString(), start.toISOString(), signal)
    if (
      !signal?.aborted &&
      generation === calendarReadGeneration &&
      mutation === mutationGeneration &&
      user.value?.id === account &&
      calendarRange === range
    )
      events.value = result
  }

  async function refreshCalendarRange(signal: AbortSignal, canApply: () => boolean) {
    const range = calendarRange
    const account = user.value?.id
    if (!range || !account || loading.value || saving.value || signal.aborted || !canApply())
      return false
    const generation = ++calendarReadGeneration
    const dataGeneration = calendarDataGeneration
    const [updatedEvents, updatedTasks, updatedCalendars] = await Promise.all([
      api.listEvents(range.end.toISOString(), range.start.toISOString(), signal),
      loadAllTasks(signal),
      api.listCalendars(signal),
    ])
    if (
      signal.aborted ||
      generation !== calendarReadGeneration ||
      dataGeneration !== calendarDataGeneration ||
      user.value?.id !== account ||
      calendarRange !== range ||
      loading.value ||
      saving.value ||
      !canApply()
    )
      return false
    // Refresh only calendar data, not bootstrap/settings/daily-review state or drafts.
    events.value = updatedEvents
    tasks.value = sortTasks(updatedTasks)
    calendars.value = updatedCalendars
    return true
  }

  async function recoverCalendarMoveUndo() {
    const account = user.value?.id
    if (!account) return
    const generation = calendarMoveGeneration
    try {
      const receipts = await api.listCalendarMoveUndos()
      if (user.value?.id !== account || generation !== calendarMoveGeneration) return
      calendarMoveUndo.value = receipts[0] ?? null
      calendarMoveMessage.value = receipts.length ? 'Calendar move saved.' : ''
    } catch {
      // A receipt-list outage must not hide the rest of the workspace.
      if (user.value?.id === account && generation === calendarMoveGeneration)
        calendarMoveError.value = 'Could not recover calendar Undo. Reload to retry.'
    }
  }

  async function reloadMovedItems(generation: number) {
    const range = calendarRange
    const [updatedTasks, updatedEvents] = await Promise.all([
      loadAllTasks(),
      range
        ? api.listEvents(range.end.toISOString(), range.start.toISOString())
        : Promise.resolve(null),
    ])
    if (generation !== calendarMoveGeneration) return
    tasks.value = sortTasks(updatedTasks)
    if (updatedEvents && calendarRange === range) events.value = updatedEvents
  }

  async function moveCalendarItem(item: CalendarEvent | Task, startsAt: string, endsAt: string) {
    if (calendarMovePending.value || saving.value) return false
    const isTask = !('starts_at' in item)
    const oldStart = isTask ? item.scheduled_start : item.starts_at
    const oldEnd = isTask ? item.scheduled_end : item.ends_at
    if (
      oldStart &&
      oldEnd &&
      Date.parse(oldStart) === Date.parse(startsAt) &&
      Date.parse(oldEnd) === Date.parse(endsAt)
    )
      return false
    calendarMovePending.value = true
    saving.value = true
    calendarMoveError.value = ''
    const generation = ++calendarMoveGeneration
    try {
      const input = { starts_at: startsAt, ends_at: endsAt, expected_version: item.version }
      const receipt = await (isTask
        ? api.moveScheduledTask(item.id, input)
        : api.moveCalendarEvent(item.id, input))
      if (generation !== calendarMoveGeneration) return false
      calendarMoveUndo.value = receipt
      calendarMoveMessage.value = 'Calendar move saved.'
      try {
        await reloadMovedItems(generation)
      } catch {
        if (generation === calendarMoveGeneration)
          calendarMoveError.value =
            'Move saved. Reload to refresh the calendar; Undo is still available.'
      }
      return true
    } catch (cause) {
      if (generation === calendarMoveGeneration) calendarMoveError.value = messageFrom(cause)
      return false
    } finally {
      if (generation === calendarMoveGeneration) {
        calendarMovePending.value = false
        saving.value = false
      }
    }
  }

  async function undoCalendarMove() {
    const receipt = calendarMoveUndo.value
    if (!receipt || calendarMovePending.value || saving.value) return
    calendarMovePending.value = true
    calendarMoveUndoing.value = true
    saving.value = true
    calendarMoveError.value = ''
    const generation = ++calendarMoveGeneration
    try {
      await api.undoCalendarMove(receipt.id)
      if (generation !== calendarMoveGeneration) return
      calendarMoveUndo.value = null
      calendarMoveMessage.value = 'Move undone.'
      try {
        await reloadMovedItems(generation)
      } catch {
        if (generation === calendarMoveGeneration)
          calendarMoveError.value = 'Move undone. Reload to refresh the calendar.'
      }
    } catch (cause) {
      if (generation === calendarMoveGeneration) calendarMoveError.value = messageFrom(cause)
    } finally {
      if (generation === calendarMoveGeneration) {
        calendarMovePending.value = false
        calendarMoveUndoing.value = false
        saving.value = false
      }
    }
  }

  function dismissCalendarMoveFeedback() {
    if (calendarMovePending.value) return
    calendarMoveGeneration += 1
    calendarMoveUndo.value = null
    calendarMoveMessage.value = ''
    calendarMoveError.value = ''
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

  function dismissTaskDeletionFeedback() {
    if (taskDeletePending.value) return
    receiptReadGeneration += 1
    taskDeleteUndos.value = taskDeleteUndos.value.filter(
      (receipt) => Date.parse(receipt.expires_at) > Date.now(),
    )
    taskDeleteMessage.value = ''
    taskDeleteError.value = ''
  }

  async function recoverTaskDeleteUndos() {
    if (!user.value) return
    const account = accountGeneration
    const operation = taskDeleteGeneration
    const read = ++receiptReadGeneration
    try {
      const receipts = await api.listTaskDeleteUndos()
      if (
        account !== accountGeneration ||
        operation !== taskDeleteGeneration ||
        read !== receiptReadGeneration
      )
        return
      taskDeleteUndos.value = receipts
      taskDeleteError.value = ''
    } catch {
      if (
        account === accountGeneration &&
        operation === taskDeleteGeneration &&
        read === receiptReadGeneration
      )
        taskDeleteError.value = 'Could not recover deletion Undo. Retry before its original expiry.'
    }
  }

  async function refreshDeletedItems() {
    const account = accountGeneration
    const mutation = mutationGeneration
    const read = ++workspaceReadGeneration
    const calendarRead = ++calendarReadGeneration
    const range = calendarRange
    const start = range?.start ?? new Date(new Date().setHours(0, 0, 0, 0))
    const end = range?.end ?? new Date(start.getTime() + 8 * 86400000)
    // Apply independently successful reads: one notes outage must not leave restored
    // tasks or attachment relationships hidden. Never reload settings/editor state.
    const results = await Promise.allSettled([
      loadAllTasks(),
      loadAllProjects(),
      api.listNotes(),
      api.listFiles(),
      api.getDailyPlan(localDateKey(new Date())),
      api.listLabels(),
      api.listEvents(end.toISOString(), start.toISOString()),
      api.listCalendars(),
    ])
    if (
      account !== accountGeneration ||
      mutation !== mutationGeneration ||
      read !== workspaceReadGeneration
    )
      return
    const [
      taskResult,
      projectResult,
      noteResult,
      fileResult,
      planResult,
      labelResult,
      eventResult,
      calendarResult,
    ] = results
    if (taskResult.status === 'fulfilled') tasks.value = sortTasks(taskResult.value)
    if (projectResult.status === 'fulfilled') projects.value = projectResult.value
    if (noteResult.status === 'fulfilled') notes.value = noteResult.value
    if (fileResult.status === 'fulfilled') files.value = fileResult.value
    if (planResult.status === 'fulfilled') dailyPlan.value = planResult.value
    if (labelResult.status === 'fulfilled') labels.value = labelResult.value.items
    if (calendarRead === calendarReadGeneration && calendarRange === range) {
      if (eventResult.status === 'fulfilled') events.value = eventResult.value
      if (calendarResult.status === 'fulfilled') calendars.value = calendarResult.value
    }
    if (results.some((result) => result.status === 'rejected')) throw new Error('Refresh failed')
  }

  async function retryTaskDeletionRefresh() {
    if (saving.value) return
    const operation = taskDeleteGeneration
    await recoverTaskDeleteUndos()
    if (operation !== taskDeleteGeneration) return
    try {
      await refreshDeletedItems()
    } catch {
      if (operation === taskDeleteGeneration)
        taskDeleteError.value = 'Refresh failed. Retry to update the workspace.'
    }
  }

  async function removeTask(task: Task) {
    if (saving.value || !user.value) return false
    saving.value = true
    taskDeletePending.value = true
    error.value = null
    taskDeleteError.value = ''
    const operation = ++taskDeleteGeneration
    receiptReadGeneration += 1
    try {
      const receipt = await api.deleteTaskWithUndo(task.id, task.version)
      if (operation !== taskDeleteGeneration) return false
      receiptReadGeneration += 1
      taskDeleteUndos.value = [
        receipt,
        ...taskDeleteUndos.value.filter((item) => item.id !== receipt.id),
      ]
      taskDeleteMessage.value = `Deleted “${task.title}”.`
      tasks.value = tasks.value.filter((candidate) => candidate.id !== task.id)
      if (dailyPlan.value)
        dailyPlan.value = {
          ...dailyPlan.value,
          focus_tasks: dailyPlan.value.focus_tasks.filter((focus) => focus.id !== task.id),
        }
      const eventIds = new Set(
        events.value.filter((event) => event.linked_task_id === task.id).map((event) => event.id),
      )
      const noteIds = new Set(
        notes.value
          .filter(
            (note) => note.task_id === task.id || (note.event_id && eventIds.has(note.event_id)),
          )
          .map((note) => note.id),
      )
      events.value = events.value.filter((event) => !eventIds.has(event.id))
      notes.value = notes.value.filter((note) => !noteIds.has(note.id))
      files.value = files.value.map((file) => ({
        ...file,
        task_id: file.task_id === task.id ? null : file.task_id,
        event_id: file.event_id && eventIds.has(file.event_id) ? null : file.event_id,
        note_id: file.note_id && noteIds.has(file.note_id) ? null : file.note_id,
      }))
      if (
        calendarMoveUndo.value?.task_id === task.id ||
        (calendarMoveUndo.value?.event_id && eventIds.has(calendarMoveUndo.value.event_id))
      )
        dismissCalendarMoveFeedback()
      try {
        await refreshDeletedItems()
      } catch {
        if (operation === taskDeleteGeneration)
          taskDeleteError.value =
            'Deletion saved, but refresh failed. Undo is still available; retry refresh.'
      }
      return operation === taskDeleteGeneration
    } catch (cause) {
      if (operation !== taskDeleteGeneration) return false
      error.value = messageFrom(cause)
      throw cause
    } finally {
      if (operation === taskDeleteGeneration) {
        taskDeletePending.value = false
        saving.value = false
      }
    }
  }

  async function undoTaskDeletion(receipt: TaskDeleteUndo) {
    if (saving.value || !user.value) return
    saving.value = true
    taskDeletePending.value = true
    taskDeleteError.value = ''
    const operation = ++taskDeleteGeneration
    receiptReadGeneration += 1
    try {
      await api.consumeTaskDeleteUndo(receipt.id)
      if (operation !== taskDeleteGeneration) return
      receiptReadGeneration += 1
      taskDeleteUndos.value = taskDeleteUndos.value.filter((item) => item.id !== receipt.id)
      taskDeleteMessage.value = `Restored “${receipt.task_title}”.`
      try {
        await refreshDeletedItems()
      } catch {
        if (operation === taskDeleteGeneration)
          taskDeleteError.value = 'Restoration saved, but refresh failed. Retry refresh.'
      }
    } catch (cause) {
      if (operation !== taskDeleteGeneration) return
      // Re-fetch is authoritative for consumed/expired/invalidated receipts, and
      // also handles a lost successful response. Never claim a restore on error.
      await recoverTaskDeleteUndos()
      if (operation === taskDeleteGeneration)
        taskDeleteError.value = `${messageFrom(cause)} Refresh to check the task and remaining Undo.`
    } finally {
      if (operation === taskDeleteGeneration) {
        taskDeletePending.value = false
        saving.value = false
      }
    }
  }

  async function saveSettings(updated: UserSettings) {
    settings.value = await api.updateSettings(updated)
    return settings.value
  }

  async function deleteAccount() {
    sessionRequest?.abort()
    bootstrapGeneration += 1
    await api.deleteAccount()
    capabilityGeneration += 1
    calendarMoveUndo.value = null
    calendarMoveMessage.value = ''
    calendarMoveError.value = ''
    user.value = null
    operationsAllowed.value = false
    projects.value = []
    tasks.value = []
    calendars.value = []
    events.value = []
    notes.value = []
    files.value = []
    resetFileUsage()
    authenticationRequired.value = true
  }

  async function logout() {
    sessionRequest?.abort()
    bootstrapGeneration += 1
    await api.logout()
    capabilityGeneration += 1
    calendarMoveUndo.value = null
    calendarMoveMessage.value = ''
    calendarMoveError.value = ''
    user.value = null
    operationsAllowed.value = false
    projects.value = []
    tasks.value = []
    calendars.value = []
    events.value = []
    notes.value = []
    files.value = []
    resetFileUsage()
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

  function resetFileUsage() {
    usageGeneration += 1
    usageRequest = null
    fileUsage.value = null
    fileUsageLoading.value = false
    fileUsageError.value = ''
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
    fileUsage,
    fileUsageLoading,
    fileUsageError,
    refreshFileUsage,
    user,
    operationsAllowed,
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
    refreshCalendarRange,
    addCalendar,
    editCalendar,
    removeCalendar,
    addEvent,
    editEvent,
    removeEvent,
    calendarMoveUndo,
    calendarMovePending,
    calendarMoveUndoing,
    calendarMoveMessage,
    calendarMoveError,
    moveCalendarItem,
    undoCalendarMove,
    dismissCalendarMoveFeedback,
    startDailyReview,
    completeDailyReview,
    setDailyFocus,
    reorderTask,
    removeTask,
    taskDeleteUndos,
    taskDeletePending,
    taskDeleteMessage,
    taskDeleteError,
    recoverTaskDeleteUndos,
    dismissTaskDeletionFeedback,
    retryTaskDeletionRefresh,
    undoTaskDeletion,
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

function loadAllTasks(signal?: AbortSignal): Promise<Task[]> {
  return collectCursorPages((cursor) => api.listTasks(undefined, cursor, signal))
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
