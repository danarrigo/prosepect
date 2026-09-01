import { describe, expect, it } from 'vitest'
import { applyDeadlineSuggestion, detectDeadlineSuggestion } from './deadline-suggestions'

const reference = new Date(2026, 7, 29, 14)

describe('deadline suggestions', () => {
  it('suggests tomorrow without changing the input before application', () => {
    const input = 'Submit report tomorrow'
    const suggestion = detectDeadlineSuggestion(input, reference)

    expect(input).toBe('Submit report tomorrow')
    expect(suggestion).toMatchObject({ dueDate: '2026-08-30', label: 'Tomorrow' })
    expect(applyDeadlineSuggestion(input, suggestion!)).toBe('Submit report')
  })

  it('recognizes weekdays and removes their natural-language prefix', () => {
    const input = 'Review release plan on Monday'
    const suggestion = detectDeadlineSuggestion(input, reference)

    expect(suggestion?.dueDate).toBe('2026-08-31')
    expect(applyDeadlineSuggestion(input, suggestion!)).toBe('Review release plan')
  })

  it('recognizes relative, word-based, and explicit dates', () => {
    expect(detectDeadlineSuggestion('Prepare launch in 3 days', reference)?.dueDate).toBe(
      '2026-09-01',
    )
    expect(detectDeadlineSuggestion('Prepare launch in two weeks', reference)?.dueDate).toBe(
      '2026-09-12',
    )
    expect(detectDeadlineSuggestion('Prepare launch by 2026-09-12', reference)?.dueDate).toBe(
      '2026-09-12',
    )
    expect(detectDeadlineSuggestion('Prepare launch by September 15', reference)?.dueDate).toBe(
      '2026-09-15',
    )
    expect(detectDeadlineSuggestion('Prepare launch by 2026-02-30', reference)).toBeNull()
  })

  it('uses Todoist semantics for next weekdays', () => {
    const suggestion = detectDeadlineSuggestion('Prepare launch next Friday', reference)

    expect(suggestion?.dueDate).toBe('2026-09-11')
    expect(applyDeadlineSuggestion('Prepare launch next Friday', suggestion!)).toBe(
      'Prepare launch',
    )
  })

  it('does not match keywords inside other words', () => {
    expect(detectDeadlineSuggestion('Visit Tomorrowland', reference)).toBeNull()
  })
})
