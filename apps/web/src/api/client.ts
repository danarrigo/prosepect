import createClient from 'openapi-fetch'
import type { paths } from './schema'
import type {
  ActivityEntry,
  Calendar,
  CalendarEvent,
  CreateCalendarEventRequest,
  CreateCalendarRequest,
  CreateNoteRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  DailyPlan,
  DailyReview,
  FileRecord,
  GoogleIntegrationStatus,
  LabelList,
  Note,
  Project,
  ProjectPage,
  Task,
  TodoistImportRequest,
  TodoistImportResult,
  ReviewTaskDecision,
  SearchResult,
  SessionResponse,
  SyncConflict,
  Synchronization,
  TaskPage,
  UpdateCalendarEventRequest,
  UpdateCalendarRequest,
  UpdateNoteRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UserSettings,
} from './types'

const API_URL = import.meta.env.VITE_API_URL ?? ''
const USER_ID_KEY = 'prosepect.development-user-id'

export function apiUrl(path: string, baseUrl = API_URL) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBaseUrl}${normalizedPath}`
}
const client = createClient<paths>({ baseUrl: API_URL, credentials: 'include' })
let csrfToken = ''

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

client.use({
  onRequest({ request }) {
    const userId = localStorage.getItem(USER_ID_KEY)
    if (userId) request.headers.set('x-prosepect-user-id', userId)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && csrfToken) {
      request.headers.set('x-csrf-token', csrfToken)
    }
    return request
  },
})

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function startDevelopmentSession(): Promise<SessionResponse> {
  const result = await client.POST('/api/v1/development/session')
  const session = unwrap(result)
  csrfToken = session.csrf_token
  localStorage.setItem(USER_ID_KEY, session.user.id)
  return session
}

export async function getSession(): Promise<SessionResponse> {
  const session = unwrap(await client.GET('/api/v1/session'))
  csrfToken = session.csrf_token
  return session
}

export async function logout(): Promise<void> {
  unwrap(await client.POST('/api/v1/session/logout'))
  csrfToken = ''
  localStorage.removeItem(USER_ID_KEY)
}

export async function getGoogleIntegration(): Promise<GoogleIntegrationStatus> {
  return unwrap(await client.GET('/api/v1/integrations/google'))
}

export async function discoverGoogleCalendars(): Promise<Synchronization> {
  return unwrap(await client.POST('/api/v1/integrations/google/calendars/discover'))
}

export async function synchronize(calendarId?: string): Promise<Synchronization> {
  return unwrap(
    await client.POST('/api/v1/synchronizations', {
      body: {
        calendar_id: calendarId ?? null,
        idempotency_key: `manual:${calendarId ?? 'all'}:${Date.now()}`,
      },
    }),
  )
}

export async function revokeGoogleIntegration(): Promise<Synchronization> {
  return unwrap(await client.DELETE('/api/v1/integrations/google'))
}

export async function listSyncConflicts(): Promise<SyncConflict[]> {
  return unwrap(await client.GET('/api/v1/sync-conflicts')).items
}

export async function resolveSyncConflict(
  conflictId: string,
  resolution: 'google' | 'prosepect' | 'latest',
): Promise<SyncConflict> {
  return unwrap(
    await client.POST('/api/v1/sync-conflicts/{conflict_id}/resolve', {
      params: { path: { conflict_id: conflictId } },
      body: { resolution },
    }),
  )
}

export async function listActivity(): Promise<ActivityEntry[]> {
  return unwrap(await client.GET('/api/v1/activity')).items
}

export async function listFiles(
  filters: {
    project_id?: string
    task_id?: string
    note_id?: string
    event_id?: string
  } = {},
): Promise<FileRecord[]> {
  return unwrap(
    await client.GET('/api/v1/files', {
      params: { query: filters },
    }),
  ).items
}

export async function uploadFile(
  file: File,
  link: { project_id?: string; task_id?: string; note_id?: string; event_id?: string } = {},
): Promise<FileRecord> {
  const form = new FormData()
  form.append('file', file)
  for (const [key, value] of Object.entries(link)) {
    if (value) form.append(key, value)
  }
  const headers = new Headers()
  if (csrfToken) headers.set('x-csrf-token', csrfToken)
  const userId = localStorage.getItem(USER_ID_KEY)
  if (userId) headers.set('x-prosepect-user-id', userId)
  const response = await fetch(apiUrl('/api/v1/files'), {
    method: 'POST',
    body: form,
    headers,
    credentials: 'include',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(body?.error?.message ?? `file upload failed (${response.status})`)
  }
  return (await response.json()) as FileRecord
}

export async function deleteFile(fileId: string): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/files/{file_id}', {
      params: { path: { file_id: fileId } },
    }),
  )
}

export async function recordReminderDelivery(): Promise<void> {
  unwrap(await client.POST('/api/v1/telemetry/reminder-delivered', {}))
}

export async function getSettings(): Promise<UserSettings> {
  return unwrap(await client.GET('/api/v1/settings'))
}

export async function updateSettings(settings: UserSettings): Promise<UserSettings> {
  return unwrap(
    await client.PUT('/api/v1/settings', {
      body: {
        theme: settings.theme,
        automatic_daily_review: settings.automatic_daily_review,
        sync_conflict_policy: settings.sync_conflict_policy,
        expected_version: settings.version,
      },
    }),
  )
}

export async function importTodoist(input: TodoistImportRequest): Promise<TodoistImportResult> {
  return unwrap(await client.POST('/api/v1/imports/todoist', { body: input }))
}

export async function deleteAccount(): Promise<void> {
  unwrap(await client.DELETE('/api/v1/account', { body: { confirmation: 'DELETE' } }))
  csrfToken = ''
  localStorage.removeItem(USER_ID_KEY)
}

export async function listNotes(): Promise<Note[]> {
  return unwrap(await client.GET('/api/v1/notes')).items
}

export async function createNote(input: CreateNoteRequest): Promise<Note> {
  return unwrap(await client.POST('/api/v1/notes', { body: input }))
}

export async function updateNote(noteId: string, input: UpdateNoteRequest): Promise<Note> {
  return unwrap(
    await client.PUT('/api/v1/notes/{note_id}', {
      params: { path: { note_id: noteId } },
      body: input,
    }),
  )
}

export async function deleteNote(noteId: string, expectedVersion: number): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/notes/{note_id}', {
      params: {
        path: { note_id: noteId },
        query: { expected_version: expectedVersion },
      },
    }),
  )
}

export async function search(query: string): Promise<SearchResult[]> {
  return unwrap(
    await client.GET('/api/v1/search', {
      params: { query: { q: query, limit: 20 } },
    }),
  ).items
}

export async function listCalendars(): Promise<Calendar[]> {
  return unwrap(await client.GET('/api/v1/calendars')).items
}

export async function createCalendar(input: CreateCalendarRequest): Promise<Calendar> {
  return unwrap(await client.POST('/api/v1/calendars', { body: input }))
}

export async function updateCalendar(
  calendarId: string,
  input: UpdateCalendarRequest,
): Promise<Calendar> {
  return unwrap(
    await client.PUT('/api/v1/calendars/{calendar_id}', {
      params: { path: { calendar_id: calendarId } },
      body: input,
    }),
  )
}

export async function deleteCalendar(calendarId: string, expectedVersion: number): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/calendars/{calendar_id}', {
      params: {
        path: { calendar_id: calendarId },
        query: { expected_version: expectedVersion },
      },
    }),
  )
}

export async function listEvents(
  startsBefore: string,
  endsAfter: string,
): Promise<CalendarEvent[]> {
  return unwrap(
    await client.GET('/api/v1/events', {
      params: { query: { starts_before: startsBefore, ends_after: endsAfter } },
    }),
  ).items
}

export async function createEvent(input: CreateCalendarEventRequest): Promise<CalendarEvent> {
  return unwrap(await client.POST('/api/v1/events', { body: input }))
}

export async function updateEvent(
  eventId: string,
  input: UpdateCalendarEventRequest,
): Promise<CalendarEvent> {
  return unwrap(
    await client.PUT('/api/v1/events/{event_id}', {
      params: { path: { event_id: eventId } },
      body: input,
    }),
  )
}

export async function deleteEvent(eventId: string, expectedVersion: number): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/events/{event_id}', {
      params: {
        path: { event_id: eventId },
        query: { expected_version: expectedVersion },
      },
    }),
  )
}

export async function startDailyReview(date: string, manual = false): Promise<DailyReview | null> {
  return (
    unwrap(
      await client.POST('/api/v1/daily-reviews/{date}/start', {
        params: { path: { date } },
        body: { manual },
      }),
    ).review ?? null
  )
}

export async function completeDailyReview(
  date: string,
  decisions: ReviewTaskDecision[],
  expectedVersion: number,
): Promise<DailyReview> {
  return unwrap(
    await client.POST('/api/v1/daily-reviews/{date}/complete', {
      params: { path: { date } },
      body: { decisions, expected_version: expectedVersion },
    }),
  )
}

export async function getDailyPlan(date: string): Promise<DailyPlan> {
  return unwrap(
    await client.GET('/api/v1/daily-plans/{date}', {
      params: { path: { date } },
    }),
  )
}

export async function updateDailyFocus(date: string, taskIds: string[]): Promise<DailyPlan> {
  return unwrap(
    await client.PUT('/api/v1/daily-plans/{date}/focus', {
      params: { path: { date } },
      body: { task_ids: taskIds },
    }),
  )
}

export async function listLabels(): Promise<LabelList> {
  return unwrap(await client.GET('/api/v1/labels'))
}

export async function listProjects(cursor?: string): Promise<ProjectPage> {
  const result = await client.GET('/api/v1/projects', {
    params: { query: { cursor, limit: 100 } },
  })
  return unwrap(result)
}

export async function createProject(input: CreateProjectRequest): Promise<Project> {
  return unwrap(await client.POST('/api/v1/projects', { body: input }))
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectRequest,
): Promise<Project> {
  return unwrap(
    await client.PUT('/api/v1/projects/{project_id}', {
      params: { path: { project_id: projectId } },
      body: input,
    }),
  )
}

export async function deleteProject(projectId: string, expectedVersion: number): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/projects/{project_id}', {
      params: {
        path: { project_id: projectId },
        query: { expected_version: expectedVersion },
      },
    }),
  )
}

export async function listTasks(projectId?: string, cursor?: string): Promise<TaskPage> {
  const result = await client.GET('/api/v1/tasks', {
    params: {
      query: {
        project_id: projectId,
        cursor,
        limit: 100,
      },
    },
  })
  return unwrap(result)
}

export async function createTask(input: CreateTaskRequest): Promise<Task> {
  return unwrap(await client.POST('/api/v1/tasks', { body: input }))
}

export async function reorderTasks(taskIds: string[]): Promise<void> {
  unwrap(await client.PUT('/api/v1/tasks/order', { body: { task_ids: taskIds } }))
}

export async function updateTask(taskId: string, input: UpdateTaskRequest): Promise<Task> {
  return unwrap(
    await client.PUT('/api/v1/tasks/{task_id}', {
      params: { path: { task_id: taskId } },
      body: input,
    }),
  )
}

export async function deleteTask(taskId: string, expectedVersion: number): Promise<void> {
  unwrap(
    await client.DELETE('/api/v1/tasks/{task_id}', {
      params: {
        path: { task_id: taskId },
        query: { expected_version: expectedVersion },
      },
    }),
  )
}

function unwrap<T>({
  data,
  error,
  response,
}: {
  data?: T
  error?: unknown
  response: Response
}): T {
  if (response.ok && data !== undefined) return data
  if (response.ok && response.status === 204) return undefined as T

  const envelope = isErrorEnvelope(error) ? error : undefined
  throw new ApiError(
    envelope?.error?.message ?? `Request failed with status ${response.status}`,
    response.status,
    envelope?.error?.code ?? 'request_failed',
  )
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return typeof value === 'object' && value !== null && 'error' in value
}
