import { ApiError, apiUrl } from './client'

// Temporary narrow contract until remote OpenAPI generation; source: api/src/operations.rs.
export interface OperationsSnapshot {
  as_of: string
  api: 'ok' | 'unavailable'
  database: 'ok' | 'unavailable'
  metrics: {
    accounts: number
    file_bytes: number
    pending: number
    running: number
    retryable: number
    final_failed_all_time: number
    succeeded_all_time: number
    oldest_waiting_created_at: string | null
    latest_completed_job_at: string | null
  } | null
  limits: {
    max_user_accounts: number | null
    max_total_file_storage_bytes: number
    max_user_file_storage_bytes: number
    max_file_size_bytes: number
  }
}

async function operationsGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const headers = new Headers()
  const userId = localStorage.getItem('prosepect.development-user-id')
  if (userId) headers.set('x-prosepect-user-id', userId)
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    headers,
    signal,
  })
  if (!response.ok) throw new ApiError('Operations request failed.', response.status, 'operations')
  return response.json() as Promise<T>
}

export function getOperationsCapability(signal?: AbortSignal) {
  return operationsGet<boolean>('/api/v1/operations/capability', signal)
}

export function getOperationsSnapshot(signal?: AbortSignal) {
  return operationsGet<OperationsSnapshot>('/api/v1/operations', signal)
}
