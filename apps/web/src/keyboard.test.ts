import { describe, expect, it } from 'vitest'
import { isEditableTarget, resolveKeyboardShortcut } from './keyboard'

function key(
  value: string,
  overrides: Partial<KeyboardEvent> = {},
  awaitingGo = false,
  editable = false,
) {
  return resolveKeyboardShortcut(
    {
      key: value,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
      ...overrides,
    },
    awaitingGo,
    editable,
  )
}

describe('keyboard shortcuts', () => {
  it('resolves navigation sequences', () => {
    expect(key('g')).toEqual({ action: null, awaitingGo: true, handled: true })
    expect(key('c', {}, true)).toEqual({
      action: 'navigate-calendar',
      awaitingGo: false,
      handled: true,
    })
  })

  it('resolves direct actions and command surfaces', () => {
    expect(key('n').action).toBe('create-task')
    expect(key('e').action).toBe('create-event')
    expect(key('/').action).toBe('focus-search')
    expect(key('?', { shiftKey: true }).action).toBe('open-shortcut-help')
    expect(key('k', { ctrlKey: true }, false, true).action).toBe('open-command-palette')
  })

  it('does not fire plain-key commands while typing or using unsupported modifiers', () => {
    expect(key('n', {}, false, true).handled).toBe(false)
    expect(key('n', { altKey: true }).handled).toBe(false)
    expect(key('n', { repeat: true }).handled).toBe(false)
  })

  it('recognizes editable descendants', () => {
    const wrapper = document.createElement('div')
    const input = document.createElement('input')
    wrapper.append(input)
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(wrapper)).toBe(false)
  })
})
