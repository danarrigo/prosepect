export type KeyboardCommandId =
  | 'navigate-today'
  | 'navigate-projects'
  | 'navigate-calendar'
  | 'navigate-notes'
  | 'navigate-settings'
  | 'create-task'
  | 'create-event'
  | 'focus-search'

export interface KeyboardCommand {
  id: KeyboardCommandId
  label: string
  group: 'Navigation' | 'Actions'
  shortcut: string[]
  keywords: string
}

export const keyboardCommands: KeyboardCommand[] = [
  {
    id: 'navigate-today',
    label: 'Go to Today',
    group: 'Navigation',
    shortcut: ['G', 'T'],
    keywords: 'home dashboard',
  },
  {
    id: 'navigate-projects',
    label: 'Go to Projects',
    group: 'Navigation',
    shortcut: ['G', 'P'],
    keywords: 'projects work',
  },
  {
    id: 'navigate-calendar',
    label: 'Go to Calendar',
    group: 'Navigation',
    shortcut: ['G', 'C'],
    keywords: 'calendar schedule events',
  },
  {
    id: 'navigate-notes',
    label: 'Go to Notes',
    group: 'Navigation',
    shortcut: ['G', 'N'],
    keywords: 'notes writing',
  },
  {
    id: 'navigate-settings',
    label: 'Go to Settings',
    group: 'Navigation',
    shortcut: ['G', 'S'],
    keywords: 'settings preferences account',
  },
  {
    id: 'create-task',
    label: 'Create task',
    group: 'Actions',
    shortcut: ['N'],
    keywords: 'new add task',
  },
  {
    id: 'create-event',
    label: 'Create event',
    group: 'Actions',
    shortcut: ['E'],
    keywords: 'new add event calendar',
  },
  {
    id: 'focus-search',
    label: 'Search workspace',
    group: 'Actions',
    shortcut: ['/'],
    keywords: 'find search workspace',
  },
]

export type GlobalKeyboardAction = KeyboardCommandId | 'open-command-palette' | 'open-shortcut-help'

export interface ShortcutResolution {
  action: GlobalKeyboardAction | null
  awaitingGo: boolean
  handled: boolean
}

const goCommands: Partial<Record<string, KeyboardCommandId>> = {
  t: 'navigate-today',
  p: 'navigate-projects',
  c: 'navigate-calendar',
  n: 'navigate-notes',
  s: 'navigate-settings',
}

const directCommands: Partial<Record<string, KeyboardCommandId>> = {
  n: 'create-task',
  e: 'create-event',
  '/': 'focus-search',
}

export function resolveKeyboardShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented'
  >,
  awaitingGo: boolean,
  editable: boolean,
): ShortcutResolution {
  const none = { action: null, awaitingGo: false, handled: false } as const
  if (event.defaultPrevented || event.repeat) return none

  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'k') {
    return { action: 'open-command-palette', awaitingGo: false, handled: true }
  }

  if (editable || event.ctrlKey || event.metaKey || event.altKey) return none

  if (event.key === '?') {
    return { action: 'open-shortcut-help', awaitingGo: false, handled: true }
  }

  if (awaitingGo) {
    const action = goCommands[key] ?? null
    return { action, awaitingGo: false, handled: Boolean(action) }
  }

  if (!event.shiftKey && key === 'g') {
    return { action: null, awaitingGo: true, handled: true }
  }

  if (event.shiftKey) return none
  const action = directCommands[key] ?? null
  return { action, awaitingGo: false, handled: Boolean(action) }
}

export function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest('input, textarea, select')))
  )
}
