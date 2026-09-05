import { describe, expect, it } from 'vitest'
import type { Synchronization } from './api/types'
import { synchronizationActive, synchronizationMessage } from './sync-status'

const now = '2026-09-01T09:00:00Z'

function job(fields: Partial<Synchronization>): Synchronization {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    calendar_id: null,
    kind: 'calendar_sync',
    status: 'pending',
    attempt_count: 0,
    available_at: now,
    last_error: null,
    created_at: now,
    updated_at: now,
    ...fields,
  }
}

describe('sync status copy', () => {
  it('distinguishes queued, running, retrying, failed, and succeeded jobs', () => {
    expect(synchronizationMessage(job({ status: 'pending' }))).toContain('queued')
    expect(synchronizationMessage(job({ status: 'running' }))).toContain('running')
    expect(synchronizationMessage(job({ status: 'failed', attempt_count: 3 }))).toContain(
      'Retry scheduled',
    )
    expect(synchronizationMessage(job({ status: 'failed', attempt_count: 8 }))).toContain(
      'stopped after repeated failures',
    )
    expect(synchronizationMessage(job({ status: 'succeeded' }))).toContain(
      'Check any remaining jobs or conflicts',
    )
  })

  it('uses action-specific copy without exposing provider error details', () => {
    const message = synchronizationMessage(
      job({ kind: 'credential_revoke', status: 'failed', attempt_count: 8, last_error: 'secret' }),
    )

    expect(message).toContain('Disconnection stopped')
    expect(message).not.toContain('secret')
  })

  it('keeps retryable failures active until the final attempt', () => {
    expect(synchronizationActive(job({ status: 'failed', attempt_count: 7 }))).toBe(true)
    expect(synchronizationActive(job({ status: 'failed', attempt_count: 8 }))).toBe(false)
    expect(synchronizationActive(job({ status: 'succeeded' }))).toBe(false)
  })
})
