import type { Synchronization } from './api/types'

export function synchronizationMessage(job: Synchronization) {
  const action =
    job.kind === 'credential_revoke'
      ? 'Disconnection'
      : job.kind === 'calendar_discovery'
        ? 'Calendar discovery'
        : 'Synchronization'
  if (job.status === 'pending')
    return `${action} queued. Waiting for the worker; changes are not applied yet.`
  if (job.status === 'running') return `${action} is running.`
  if (job.status === 'failed' && job.attempt_count < 8) {
    return `${action} could not finish. Retry scheduled for ${new Date(job.available_at).toLocaleString()}. You can leave this page.`
  }
  if (job.status === 'failed')
    return `${action} stopped after repeated failures. Try again; if it keeps failing, reconnect Google and check calendar permissions.`
  if (job.status === 'succeeded')
    return `${action} completed. Check any remaining jobs or conflicts below.`
  return `${action} status is unavailable. Refresh status before trying again.`
}

export function synchronizationActive(job: Synchronization | null) {
  return (
    !!job &&
    (job.status === 'pending' ||
      job.status === 'running' ||
      (job.status === 'failed' && job.attempt_count < 8))
  )
}
