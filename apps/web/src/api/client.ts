import createClient from 'openapi-fetch'
import type { paths } from './schema'
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  DevelopmentSession,
  Project,
  ProjectPage,
  Task,
  TaskPage,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './types'

const API_URL = import.meta.env.VITE_API_URL ?? ''
const USER_ID_KEY = 'prosepect.development-user-id'
const client = createClient<paths>({ baseUrl: API_URL })

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

export async function startDevelopmentSession(): Promise<DevelopmentSession> {
  const result = await client.POST('/api/v1/development/session')
  const session = unwrap(result)
  localStorage.setItem(USER_ID_KEY, session.user_id)
  return session
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
