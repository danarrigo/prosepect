import { describe, expect, it } from 'vitest'
import { apiUrl } from './client'

describe('apiUrl', () => {
  it('targets the configured production API origin', () => {
    expect(apiUrl('/api/v1/auth/google/start', 'https://api.prosepect.com/')).toBe(
      'https://api.prosepect.com/api/v1/auth/google/start',
    )
  })

  it('keeps same-origin paths in local development', () => {
    expect(apiUrl('/api/v1/auth/google/start', '')).toBe('/api/v1/auth/google/start')
  })
})
