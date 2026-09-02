<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarCog, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import type { CalendarEvent, EventRecurrence, Task, TaskPriority } from '../api/types'
import AttachmentPanel from '../components/AttachmentPanel.vue'
import TaskList from '../components/TaskList.vue'
import {
  clampTimelineDuration,
  clampTimelineStart,
  clampTimelineStartResize,
  defaultEventCalendarId,
  eventOccursOnDate,
  localDateKey as dateKey,
  parseLocalDateKey as parseDateKey,
  startOfLocalDay as startOfDay,
  tasksForDate as findTasksForDate,
  timelineMinuteFromOffset,
} from '../calendar'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const route = useRoute()
const router = useRouter()
const today = ref(startOfDay(new Date()))
const initialDate = parseDateKey(route.query.date) ?? today.value
const selectedDate = ref(initialDate)
const monthCursor = ref(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
const viewMode = ref<'day' | 'week' | 'month' | 'agenda'>('month')
const eventFormOpen = ref(false)
const editingEvent = ref<CalendarEvent | null>(null)
const eventDeleteArmed = ref(false)
const eventTitle = ref('')
const eventDescription = ref('')
const eventCalendarId = ref('')
const eventStart = ref('')
const eventEnd = ref('')
const eventLocation = ref('')
const eventAttendees = ref('')
const eventAllDay = ref(false)
const eventRecurrence = ref<EventRecurrence>('none')
const eventRecurrenceUntil = ref('')
const taskFormOpen = ref(false)
const taskTitle = ref('')
const taskDescription = ref('')
const taskProjectId = ref('')
const taskPriority = ref<TaskPriority>('medium')
const taskStart = ref('')
const taskEnd = ref('')
const taskTitleInput = ref<HTMLInputElement | null>(null)
const draggedTimelineItemKey = ref<string | null>(null)
const timelineMovePreview = ref<{ key: string; startsAt: string; endsAt: string } | null>(null)
const timelineResizePreview = ref<{
  key: string
  startsAt: string
  endsAt: string
} | null>(null)
const timelineDeleteZone = ref<HTMLElement | null>(null)
const timelineDeleteActive = ref(false)
const suppressedTimelineClickKey = ref<string | null>(null)
const timelineAnnouncement = ref('')
const calendarManagerOpen = ref(false)
const newCalendarName = ref('')
const newCalendarColor = ref('#64748b')
const editingCalendarId = ref<string | null>(null)
const editingCalendarName = ref('')
const editingCalendarColor = ref('#64748b')
let dateRefreshTimer: ReturnType<typeof setInterval> | undefined
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const timelineHours = Array.from({ length: 25 }, (_, hour) => hour)
const timelineHalfHours = Array.from({ length: 47 }, (_, index) => index + 1)
const timelineHourHeight = 48
const timelineHeight = timelineHourHeight * 24

interface TimelineItem {
  key: string
  kind: 'event' | 'task'
  title: string
  startsAt: string
  endsAt: string
  color: string
  event?: CalendarEvent
  task?: Task
}

interface TimelineItemLayout extends TimelineItem {
  column: number
  columns: number
}

interface TimelineMoveState {
  item: TimelineItemLayout
  pointerStartY: number
  initialStartMinute: number
  durationMinutes: number
  moved: boolean
}

interface TimelineResizeState {
  item: TimelineItemLayout
  edge: 'start' | 'end'
  pointerStartY: number
  initialStart: Date
  initialEnd: Date
}

let timelineMoveState: TimelineMoveState | null = null
let timelineResizeState: TimelineResizeState | null = null

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthCursor.value),
)
const selectedLabel = computed(() =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(selectedDate.value),
)
const selectedWeekday = computed(() =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(selectedDate.value),
)
const preferredEventCalendarId = computed(() =>
  defaultEventCalendarId(store.calendars, store.user?.email),
)
const eventDraftDurationMinutes = computed(() => {
  if (!eventStart.value || !eventEnd.value) return null
  const duration = Math.round(
    (new Date(eventEnd.value).getTime() - new Date(eventStart.value).getTime()) / 60_000,
  )
  return duration > 0 ? duration : null
})
const eventDraftDurationLabel = computed(() => {
  const duration = eventDraftDurationMinutes.value
  if (!duration) return ''
  const hours = Math.floor(duration / 60)
  const minutes = duration % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ')
})
const calendarDays = computed(() => monthDays(monthCursor.value))
const selectedTasks = computed(() => tasksForDate(selectedDate.value))
const selectedEvents = computed(() => eventsForDate(selectedDate.value))
const timedEvents = computed(() => selectedEvents.value.filter((event) => !event.all_day))
const allDayEvents = computed(() => selectedEvents.value.filter((event) => event.all_day))
const timedTasks = computed(() =>
  selectedTasks.value.filter((task) => task.scheduled_start && task.scheduled_end),
)
const untimedTasks = computed(() => selectedTasks.value.filter((task) => !task.scheduled_start))
const timelineItems = computed(() =>
  layoutTimelineItems([
    ...timedEvents.value.map((event) => {
      const range = eventTimelineRange(event, selectedDate.value)
      return {
        key: `event:${event.id}`,
        kind: 'event' as const,
        title: event.title,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        color: calendarFor(event)?.color ?? '#64748b',
        event,
      }
    }),
    ...timedTasks.value.map((task) => ({
      key: `task:${task.id}`,
      kind: 'task' as const,
      title: task.title,
      startsAt: task.scheduled_start!,
      endsAt: task.scheduled_end!,
      color: '#64748b',
      task,
    })),
  ]),
)
const currentTimeOffset = computed(() => {
  if (!sameDay(selectedDate.value, today.value)) return null
  const now = new Date()
  return ((now.getHours() * 60 + now.getMinutes()) / 60) * timelineHourHeight
})
const weekDays = computed(() => {
  const start = new Date(selectedDate.value)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
})
const agendaDateCandidates = computed(() =>
  Array.from({ length: 30 }, (_, index) => {
    const date = new Date(selectedDate.value)
    date.setDate(date.getDate() + index)
    return date
  }),
)
const visibleDates = computed(() => {
  if (viewMode.value === 'month') return calendarDays.value
  if (viewMode.value === 'week') return weekDays.value
  if (viewMode.value === 'agenda') return agendaDateCandidates.value
  return [selectedDate.value]
})
const tasksByDate = computed(
  () =>
    new Map(visibleDates.value.map((date) => [dateKey(date), findTasksForDate(store.tasks, date)])),
)
const eventsByDate = computed(
  () =>
    new Map(
      visibleDates.value.map((date) => [
        dateKey(date),
        store.events.filter((event) => !event.linked_task_id && eventOccursOnDate(event, date)),
      ]),
    ),
)
const agendaDays = computed(() =>
  agendaDateCandidates.value.filter(
    (date) => tasksForDate(date).length || eventsForDate(date).length,
  ),
)

watch(
  () => store.calendars,
  (calendars) => {
    if (
      calendars.length &&
      (!eventCalendarId.value ||
        !calendars.some((calendar) => calendar.id === eventCalendarId.value))
    ) {
      eventCalendarId.value = preferredEventCalendarId.value
    }
  },
  { immediate: true, deep: true },
)

watch(
  [monthCursor, viewMode],
  () => {
    const { start, end } = visibleRange()
    void store.loadCalendarRange(start, end)
  },
  { immediate: true },
)

function sameDay(first: Date, second: Date) {
  return dateKey(first) === dateKey(second)
}

function tasksForDate(date: Date) {
  return tasksByDate.value.get(dateKey(date)) ?? []
}

function eventsForDate(date: Date) {
  return eventsByDate.value.get(dateKey(date)) ?? []
}

function calendarFor(event: CalendarEvent) {
  return store.calendars.find((calendar) => calendar.id === event.calendar_id)
}

function accessibleDateLabel(date: Date) {
  const label = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)
  const taskCount = tasksForDate(date).length
  const eventCount = eventsForDate(date).length
  return `${label}, ${eventCount} ${eventCount === 1 ? 'event' : 'events'}, ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`
}

function selectDate(date: Date) {
  selectedDate.value = startOfDay(date)
  if (
    date.getMonth() !== monthCursor.value.getMonth() ||
    date.getFullYear() !== monthCursor.value.getFullYear()
  ) {
    monthCursor.value = new Date(date.getFullYear(), date.getMonth(), 1)
  }
  void router.replace({ query: { date: dateKey(date), view: viewMode.value } })
}

function setView(mode: 'day' | 'week' | 'month' | 'agenda') {
  viewMode.value = mode
  void router.replace({ query: { date: dateKey(selectedDate.value), view: mode } })
}

function changePeriod(offset: number) {
  if (viewMode.value === 'month') {
    const next = new Date(monthCursor.value.getFullYear(), monthCursor.value.getMonth() + offset, 1)
    monthCursor.value = next
    selectDate(next)
    return
  }
  const days = viewMode.value === 'day' ? 1 : viewMode.value === 'week' ? 7 : 30
  const next = new Date(selectedDate.value)
  next.setDate(next.getDate() + offset * days)
  selectDate(next)
}

function refreshToday() {
  today.value = startOfDay(new Date())
}

function goToToday() {
  monthCursor.value = new Date(today.value.getFullYear(), today.value.getMonth(), 1)
  selectDate(today.value)
}

function openEventForm(date = selectedDate.value, startHour = 9) {
  taskFormOpen.value = false
  editingEvent.value = null
  eventDeleteArmed.value = false
  eventTitle.value = ''
  eventDescription.value = ''
  eventLocation.value = ''
  eventAttendees.value = ''
  eventAllDay.value = false
  eventRecurrence.value = 'none'
  eventRecurrenceUntil.value = ''
  eventCalendarId.value = preferredEventCalendarId.value
  const start = new Date(date)
  start.setHours(startHour, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1_000)
  eventStart.value = localDateTimeValue(start)
  eventEnd.value = localDateTimeValue(end)
  eventFormOpen.value = true
}

function openTaskForm(date = selectedDate.value, startHour = 9) {
  eventFormOpen.value = false
  const start = new Date(date)
  start.setHours(startHour, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1_000)
  taskTitle.value = ''
  taskDescription.value = ''
  taskProjectId.value = store.selectedProjectId ?? ''
  taskPriority.value = 'medium'
  taskStart.value = localDateTimeValue(start)
  taskEnd.value = localDateTimeValue(end)
  taskFormOpen.value = true
  void nextTick(() => taskTitleInput.value?.focus())
}

async function saveCalendarTask() {
  if (!taskTitle.value.trim() || !taskStart.value || !taskEnd.value) return
  const start = new Date(taskStart.value)
  const end = new Date(taskEnd.value)
  if (end <= start) return

  await store.addTask({
    project_id: taskProjectId.value || null,
    parent_task_id: null,
    title: taskTitle.value.trim(),
    description: taskDescription.value.trim(),
    due_at: null,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
    status: 'todo',
    priority: taskPriority.value,
    recurrence: 'none',
    labels: [],
    remind_at: null,
  })
  taskFormOpen.value = false
}

function openEventEditor(event: CalendarEvent) {
  eventDeleteArmed.value = false
  editingEvent.value = event
  eventTitle.value = event.title
  eventDescription.value = event.description
  eventCalendarId.value = event.calendar_id
  eventStart.value = localDateTimeValue(new Date(event.starts_at))
  eventEnd.value = localDateTimeValue(new Date(event.ends_at))
  eventLocation.value = event.location
  eventAttendees.value = event.attendees.join(', ')
  eventAllDay.value = event.all_day
  eventRecurrence.value = event.recurrence
  eventRecurrenceUntil.value = event.recurrence_until
    ? localDateTimeValue(new Date(event.recurrence_until))
    : ''
  eventFormOpen.value = true
}

async function saveEvent() {
  if (!eventTitle.value.trim() || !eventCalendarId.value || !eventStart.value || !eventEnd.value) {
    return
  }
  const input = {
    calendar_id: eventCalendarId.value,
    title: eventTitle.value.trim(),
    description: eventDescription.value.trim(),
    starts_at: new Date(eventStart.value).toISOString(),
    ends_at: new Date(eventEnd.value).toISOString(),
    all_day: eventAllDay.value,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    location: eventLocation.value.trim(),
    attendees: eventAttendees.value
      .split(',')
      .map((attendee) => attendee.trim())
      .filter(Boolean),
    recurrence: eventRecurrence.value,
    recurrence_until: eventRecurrenceUntil.value
      ? new Date(eventRecurrenceUntil.value).toISOString()
      : null,
  }
  if (editingEvent.value) {
    await store.editEvent(editingEvent.value, {
      ...input,
      expected_version: editingEvent.value.version,
    })
  } else {
    await store.addEvent(input)
  }
  eventFormOpen.value = false
}

async function deleteEditedEvent() {
  if (!editingEvent.value) return
  if (!eventDeleteArmed.value) {
    eventDeleteArmed.value = true
    return
  }
  await store.removeEvent(editingEvent.value)
  editingEvent.value = null
  eventDeleteArmed.value = false
  eventFormOpen.value = false
}

async function moveEvent(event: CalendarEvent, date: Date) {
  const oldStart = new Date(event.starts_at)
  const duration = new Date(event.ends_at).getTime() - oldStart.getTime()
  const start = new Date(date)
  start.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), 0)
  await store.editEvent(event, {
    calendar_id: event.calendar_id,
    title: event.title,
    description: event.description,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + duration).toISOString(),
    all_day: event.all_day,
    timezone: event.timezone,
    location: event.location,
    attendees: event.attendees,
    recurrence: event.recurrence,
    recurrence_until: event.recurrence_until ?? null,
    expected_version: event.version,
  })
}

function dropEvent(date: Date, event: DragEvent) {
  const eventId = event.dataTransfer?.getData('text/prosepect-event')
  const calendarEvent = store.events.find((candidate) => candidate.id === eventId)
  if (calendarEvent) void moveEvent(calendarEvent, date)
}

async function createCalendar() {
  if (!newCalendarName.value.trim()) return
  await store.addCalendar({ name: newCalendarName.value.trim(), color: newCalendarColor.value })
  newCalendarName.value = ''
}

function startCalendarEdit(calendar: (typeof store.calendars)[number]) {
  editingCalendarId.value = calendar.id
  editingCalendarName.value = calendar.name
  editingCalendarColor.value = calendar.color
}

async function saveCalendar(calendar: (typeof store.calendars)[number]) {
  if (!editingCalendarName.value.trim()) return
  await store.editCalendar(calendar, {
    name: editingCalendarName.value.trim(),
    color: editingCalendarColor.value,
    selected: calendar.selected,
    expected_version: calendar.version,
  })
  editingCalendarId.value = null
}

async function toggleCalendar(calendar: (typeof store.calendars)[number]) {
  await store.editCalendar(calendar, {
    name: calendar.name,
    color: calendar.color,
    selected: !calendar.selected,
    expected_version: calendar.version,
  })
}

function visibleRange() {
  if (viewMode.value === 'month') {
    const days = monthDays(monthCursor.value)
    const start = startOfDay(days[0]!)
    const end = new Date(days.at(-1)!)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }
  if (viewMode.value === 'week') {
    const start = startOfDay(weekDays.value[0]!)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start, end }
  }
  const start = startOfDay(selectedDate.value)
  const end = new Date(start)
  end.setDate(end.getDate() + (viewMode.value === 'agenda' ? 30 : 1))
  return { start, end }
}

function navigationLabel(direction: 'Previous' | 'Next') {
  return `${direction} ${viewMode.value === 'agenda' ? 'period' : viewMode.value}`
}

function eventTime(event: CalendarEvent) {
  if (event.all_day) return 'All day'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(event.starts_at),
  )
}

function eventTimelineRange(event: CalendarEvent, date: Date) {
  const originalStart = new Date(event.starts_at)
  if (event.recurrence === 'none' || sameDay(originalStart, date)) {
    return { startsAt: event.starts_at, endsAt: event.ends_at }
  }
  const duration = new Date(event.ends_at).getTime() - originalStart.getTime()
  const occurrenceStart = new Date(date)
  occurrenceStart.setHours(
    originalStart.getHours(),
    originalStart.getMinutes(),
    originalStart.getSeconds(),
    0,
  )
  return {
    startsAt: occurrenceStart.toISOString(),
    endsAt: new Date(occurrenceStart.getTime() + duration).toISOString(),
  }
}

function layoutTimelineItems(items: TimelineItem[]): TimelineItemLayout[] {
  const sorted = [...items].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
      new Date(left.endsAt).getTime() - new Date(right.endsAt).getTime(),
  )
  const layouts: TimelineItemLayout[] = []
  let group: TimelineItem[] = []
  let groupEnd = Number.NEGATIVE_INFINITY

  for (const item of sorted) {
    const start = new Date(item.startsAt).getTime()
    if (group.length && start >= groupEnd) {
      layoutTimelineGroup(group, layouts)
      group = []
      groupEnd = Number.NEGATIVE_INFINITY
    }
    group.push(item)
    groupEnd = Math.max(groupEnd, new Date(item.endsAt).getTime())
  }
  if (group.length) layoutTimelineGroup(group, layouts)
  return layouts
}

function layoutTimelineGroup(group: TimelineItem[], layouts: TimelineItemLayout[]) {
  const columnEnds: number[] = []
  const assigned = group.map((item) => {
    const start = new Date(item.startsAt).getTime()
    let column = columnEnds.findIndex((end) => end <= start)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = new Date(item.endsAt).getTime()
    return { item, column }
  })
  const columns = Math.max(1, columnEnds.length)
  for (const { item, column } of assigned) layouts.push({ ...item, column, columns })
}

function timelineItemRange(item: TimelineItem) {
  const movePreview = timelineMovePreview.value?.key === item.key ? timelineMovePreview.value : null
  const resizePreview =
    timelineResizePreview.value?.key === item.key ? timelineResizePreview.value : null
  return {
    startsAt: resizePreview?.startsAt ?? movePreview?.startsAt ?? item.startsAt,
    endsAt: resizePreview?.endsAt ?? movePreview?.endsAt ?? item.endsAt,
  }
}

function timelineItemStyle(item: TimelineItemLayout) {
  const dayStart = startOfDay(selectedDate.value).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1_000
  const range = timelineItemRange(item)
  const start = Math.max(dayStart, new Date(range.startsAt).getTime())
  const end = Math.min(dayEnd, new Date(range.endsAt).getTime())
  const top = ((start - dayStart) / 3_600_000) * timelineHourHeight
  const height = Math.max(28, ((end - start) / 3_600_000) * timelineHourHeight)
  const columnWidth = 100 / item.columns
  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${item.column * columnWidth}% + ${item.column * 2}px)`,
    width: `calc(${columnWidth}% - 4px)`,
    borderColor: item.color,
    backgroundColor: colorTint(item.color),
  }
}

function colorTint(color: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return 'rgb(248 250 252)'
  return `rgb(${Number.parseInt(match[1]!, 16)} ${Number.parseInt(match[2]!, 16)} ${Number.parseInt(match[3]!, 16)} / 0.12)`
}

function timelineItemIsCompact(item: TimelineItem) {
  const range = timelineItemRange(item)
  const dayStart = startOfDay(selectedDate.value).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1_000
  const visibleStart = Math.max(dayStart, new Date(range.startsAt).getTime())
  const visibleEnd = Math.min(dayEnd, new Date(range.endsAt).getTime())
  return visibleEnd - visibleStart < 60 * 60 * 1_000
}

function timelineTimeRange(item: TimelineItem) {
  const range = timelineItemRange(item)
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `${formatter.format(new Date(range.startsAt))}–${formatter.format(new Date(range.endsAt))}`
}

function timelineHourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function openScheduledTaskAtHour(hour: number) {
  if (hour >= 24) return
  openTaskForm(selectedDate.value, hour)
}

function startTimelineMove(item: TimelineItemLayout, event: PointerEvent) {
  if (event.button !== 0) return
  const start = new Date(item.startsAt)
  timelineMoveState = {
    item,
    pointerStartY: event.clientY,
    initialStartMinute: start.getHours() * 60 + start.getMinutes(),
    durationMinutes: Math.max(
      15,
      Math.round((new Date(item.endsAt).getTime() - start.getTime()) / 60_000),
    ),
    moved: false,
  }
  window.addEventListener('pointermove', previewTimelineMove)
  window.addEventListener('pointerup', finishTimelineMove, { once: true })
}

function previewTimelineMove(event: PointerEvent) {
  if (!timelineMoveState) return
  const deltaPixels = event.clientY - timelineMoveState.pointerStartY
  if (!timelineMoveState.moved && Math.abs(deltaPixels) < 4) return
  event.preventDefault()
  timelineMoveState.moved = true
  draggedTimelineItemKey.value = timelineMoveState.item.key
  timelineDeleteActive.value = pointerInsideTimelineDeleteZone(event)
  document.body.style.cursor = 'grabbing'
  document.body.style.userSelect = 'none'
  const deltaMinutes =
    Math.sign(deltaPixels) * timelineMinuteFromOffset(Math.abs(deltaPixels), timelineHourHeight)
  const startMinute = clampTimelineStart(
    timelineMoveState.initialStartMinute + deltaMinutes,
    timelineMoveState.durationMinutes,
  )
  const start = new Date(selectedDate.value)
  start.setHours(0, startMinute, 0, 0)
  timelineMovePreview.value = {
    key: timelineMoveState.item.key,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + timelineMoveState.durationMinutes * 60_000).toISOString(),
  }
}

function finishTimelineMove() {
  const state = timelineMoveState
  const preview = timelineMovePreview.value
  const moved = Boolean(state?.moved && preview && preview.key === state.item.key)
  const shouldDelete = Boolean(moved && timelineDeleteActive.value)
  cancelTimelineMove(false)
  if (!state || !preview || !moved) {
    timelineMovePreview.value = null
    return
  }

  suppressedTimelineClickKey.value = state.item.key
  if (shouldDelete) {
    timelineMovePreview.value = null
    void deleteTimelineItem(state.item).finally(() => clearSuppressedTimelineClick(state.item.key))
    return
  }

  const start = new Date(preview.startsAt)
  const end = new Date(preview.endsAt)
  void updateTimelineItemTime(state.item, start, end)
    .then(() => {
      timelineAnnouncement.value = `${state.item.title} moved to ${timelineTimeRange({ ...state.item, startsAt: start.toISOString(), endsAt: end.toISOString() })}`
    })
    .finally(() => {
      timelineMovePreview.value = null
      clearSuppressedTimelineClick(state.item.key)
    })
}

function pointerInsideTimelineDeleteZone(event: PointerEvent) {
  const bounds = timelineDeleteZone.value?.getBoundingClientRect()
  return Boolean(
    bounds &&
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom,
  )
}

async function deleteTimelineItem(item: TimelineItem) {
  if (item.event) await store.removeEvent(item.event)
  if (item.task) await store.removeTask(item.task)
  timelineAnnouncement.value = `${item.title} deleted`
}

function clearSuppressedTimelineClick(key: string) {
  window.setTimeout(() => {
    if (suppressedTimelineClickKey.value === key) suppressedTimelineClickKey.value = null
  }, 0)
}

function cancelTimelineMove(clearPreview = true) {
  timelineMoveState = null
  draggedTimelineItemKey.value = null
  timelineDeleteActive.value = false
  if (clearPreview) timelineMovePreview.value = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', previewTimelineMove)
  window.removeEventListener('pointerup', finishTimelineMove)
}

function openTimelineEvent(item: TimelineItemLayout) {
  if (suppressedTimelineClickKey.value === item.key || !item.event) return
  openEventEditor(item.event)
}

function startTimelineResize(item: TimelineItemLayout, event: PointerEvent, edge: 'start' | 'end') {
  event.preventDefault()
  event.stopPropagation()
  timelineResizeState = {
    item,
    edge,
    pointerStartY: event.clientY,
    initialStart: new Date(item.startsAt),
    initialEnd: new Date(item.endsAt),
  }
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', previewTimelineResize)
  window.addEventListener('pointerup', finishTimelineResize, { once: true })
}

function previewTimelineResize(event: PointerEvent) {
  if (!timelineResizeState) return
  const { item, edge, pointerStartY, initialStart, initialEnd } = timelineResizeState
  const startMinute = initialStart.getHours() * 60 + initialStart.getMinutes()
  const endMinute = sameDay(initialEnd, selectedDate.value)
    ? initialEnd.getHours() * 60 + initialEnd.getMinutes()
    : 24 * 60
  const rawDelta = ((event.clientY - pointerStartY) / timelineHourHeight) * 60
  const snappedDelta = Math.round(rawDelta / 15) * 15

  if (edge === 'start') {
    const nextStartMinute = clampTimelineStartResize(startMinute + snappedDelta, endMinute)
    const nextStart = new Date(selectedDate.value)
    nextStart.setHours(0, nextStartMinute, 0, 0)
    timelineResizePreview.value = {
      key: item.key,
      startsAt: nextStart.toISOString(),
      endsAt: initialEnd.toISOString(),
    }
    return
  }

  const initialDuration = Math.max(
    15,
    Math.round((initialEnd.getTime() - initialStart.getTime()) / 60_000),
  )
  const duration = clampTimelineDuration(startMinute, initialDuration + snappedDelta)
  timelineResizePreview.value = {
    key: item.key,
    startsAt: initialStart.toISOString(),
    endsAt: new Date(initialStart.getTime() + duration * 60_000).toISOString(),
  }
}

function finishTimelineResize() {
  const state = timelineResizeState
  const preview = timelineResizePreview.value
  cancelTimelineResize(false)
  if (!state || !preview || preview.key !== state.item.key) {
    timelineResizePreview.value = null
    return
  }
  suppressedTimelineClickKey.value = state.item.key
  const start = new Date(preview.startsAt)
  const end = new Date(preview.endsAt)
  void updateTimelineItemTime(state.item, start, end)
    .then(() => {
      timelineAnnouncement.value = `${state.item.title} resized to ${timelineTimeRange({ ...state.item, startsAt: start.toISOString(), endsAt: end.toISOString() })}`
    })
    .finally(() => {
      timelineResizePreview.value = null
      window.setTimeout(() => {
        if (suppressedTimelineClickKey.value === state.item.key) {
          suppressedTimelineClickKey.value = null
        }
      }, 0)
    })
}

function cancelTimelineResize(clearPreview = true) {
  timelineResizeState = null
  if (clearPreview) timelineResizePreview.value = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', previewTimelineResize)
  window.removeEventListener('pointerup', finishTimelineResize)
}

async function updateTimelineItemTime(item: TimelineItem, start: Date, end: Date) {
  if (item.event) {
    await store.editEvent(item.event, {
      calendar_id: item.event.calendar_id,
      title: item.event.title,
      description: item.event.description,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: item.event.all_day,
      timezone: item.event.timezone,
      location: item.event.location,
      attendees: item.event.attendees,
      recurrence: item.event.recurrence,
      recurrence_until: item.event.recurrence_until ?? null,
      expected_version: item.event.version,
    })
    return
  }
  if (item.task) {
    await store.editTask(item.task, {
      project_id: item.task.project_id,
      parent_task_id: item.task.parent_task_id,
      title: item.task.title,
      description: item.task.description,
      due_at: item.task.due_at,
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      status: item.task.status,
      priority: item.task.priority,
      recurrence: item.task.recurrence,
      labels: item.task.labels,
      remind_at: item.task.remind_at,
    })
  }
}

function localDateTimeValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

onMounted(() => {
  const queryView = route.query.view
  if (
    queryView === 'day' ||
    queryView === 'week' ||
    queryView === 'month' ||
    queryView === 'agenda'
  ) {
    viewMode.value = queryView
  }
  dateRefreshTimer = setInterval(refreshToday, 30_000)
  document.addEventListener('visibilitychange', refreshToday)
})

onBeforeUnmount(() => {
  cancelTimelineMove()
  cancelTimelineResize()
  if (dateRefreshTimer) clearInterval(dateRefreshTimer)
  document.removeEventListener('visibilitychange', refreshToday)
})

function monthDays(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="page-title !mt-0">Calendar</h1>
        <p class="page-description">Events, scheduled work, and deadlines in one place.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div
          class="flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800"
          aria-label="Calendar view"
        >
          <button
            v-for="mode in ['day', 'week', 'month', 'agenda'] as const"
            :key="mode"
            class="rounded px-2.5 py-1.5 text-xs capitalize text-slate-500 transition"
            :class="{
              'bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white': viewMode === mode,
            }"
            type="button"
            :aria-pressed="viewMode === mode"
            @click="setView(mode)"
          >
            {{ mode }}
          </button>
        </div>
        <button class="secondary-button" type="button" @click="goToToday">Today</button>
        <button
          class="icon-button"
          type="button"
          :aria-label="navigationLabel('Previous')"
          @click="changePeriod(-1)"
        >
          <ChevronLeft :size="18" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="navigationLabel('Next')"
          @click="changePeriod(1)"
        >
          <ChevronRight :size="18" />
        </button>
        <button
          class="secondary-button"
          type="button"
          aria-label="Calendars"
          @click="calendarManagerOpen = !calendarManagerOpen"
        >
          <CalendarCog :size="16" /> <span class="hidden 2xl:inline">Calendars</span>
        </button>
        <button class="secondary-button" type="button" @click="openTaskForm()">
          <Plus :size="16" /> New task
        </button>
        <button class="primary-button" type="button" @click="openEventForm()">
          <Plus :size="16" /> New event
        </button>
      </div>
    </div>

    <div
      v-if="taskFormOpen"
      class="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      @keydown.esc="taskFormOpen = false"
    >
      <button
        class="absolute inset-0 bg-slate-950/30"
        type="button"
        aria-label="Close task form"
        @click="taskFormOpen = false"
      />
      <form
        class="relative z-10 my-auto w-full max-w-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950"
        aria-label="New scheduled task"
        @submit.prevent="saveCalendarTask"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">New scheduled task</h2>
            <p class="mt-1 text-sm text-slate-500">Reserve time for focused work.</p>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close"
            @click="taskFormOpen = false"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          <label class="sm:col-span-2">
            <span class="field-label">Title</span>
            <input
              ref="taskTitleInput"
              v-model="taskTitle"
              class="field-input"
              required
              maxlength="240"
            />
          </label>
          <label>
            <span class="field-label">Starts</span>
            <input v-model="taskStart" class="field-input" type="datetime-local" required />
          </label>
          <label>
            <span class="field-label">Ends</span>
            <input v-model="taskEnd" class="field-input" type="datetime-local" required />
          </label>
          <label>
            <span class="field-label">Project</span>
            <select v-model="taskProjectId" class="field-input">
              <option value="">No project</option>
              <option
                v-for="project in store.projects.filter((item) => item.status !== 'archived')"
                :key="project.id"
                :value="project.id"
              >
                {{ project.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="field-label">Priority</span>
            <select v-model="taskPriority" class="field-input">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label class="sm:col-span-2">
            <span class="field-label">Description</span>
            <textarea
              v-model="taskDescription"
              class="field-input min-h-24 py-2"
              maxlength="10000"
            />
          </label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="secondary-button" type="button" @click="taskFormOpen = false">
            Cancel
          </button>
          <button class="primary-button" type="submit" :disabled="store.saving">Create task</button>
        </div>
      </form>
    </div>

    <section
      v-if="calendarManagerOpen"
      class="mt-8 border-y border-slate-200 py-5 dark:border-slate-800"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Calendars</h2>
        <button
          class="icon-button"
          type="button"
          aria-label="Close calendar management"
          @click="calendarManagerOpen = false"
        >
          <X :size="16" />
        </button>
      </div>
      <form
        class="mt-4 flex flex-wrap items-end gap-3"
        aria-label="New calendar"
        @submit.prevent="createCalendar"
      >
        <label class="min-w-56 flex-1"
          ><span class="field-label">Name</span
          ><input v-model="newCalendarName" class="field-input" required maxlength="120"
        /></label>
        <label
          ><span class="field-label">Color</span
          ><input
            v-model="newCalendarColor"
            class="h-10 w-14 cursor-pointer bg-transparent"
            type="color"
        /></label>
        <button class="primary-button" type="submit">Add calendar</button>
      </form>
      <div class="mt-5 divide-y divide-slate-100 dark:divide-slate-900">
        <div
          v-for="calendar in store.calendars"
          :key="calendar.id"
          class="flex items-center gap-3 py-3"
        >
          <span class="size-3 rounded-full" :style="{ backgroundColor: calendar.color }" />
          <form
            v-if="editingCalendarId === calendar.id"
            class="flex min-w-0 flex-1 items-center gap-2"
            :aria-label="`Edit ${calendar.name} calendar`"
            @submit.prevent="saveCalendar(calendar)"
          >
            <input
              v-model="editingCalendarName"
              class="field-input !h-8 min-w-0"
              required
              maxlength="120"
            />
            <input
              v-model="editingCalendarColor"
              class="size-8 shrink-0 cursor-pointer bg-transparent"
              type="color"
              aria-label="Calendar color"
            />
            <button class="primary-button !h-8 !px-3 !text-xs" type="submit">Save</button>
            <button
              class="secondary-button !h-8 !px-3 !text-xs"
              type="button"
              @click="editingCalendarId = null"
            >
              Cancel
            </button>
          </form>
          <span v-else class="min-w-0 flex-1 truncate text-sm">{{ calendar.name }}</span>
          <button
            v-if="editingCalendarId !== calendar.id"
            class="icon-button"
            type="button"
            :aria-label="`Edit ${calendar.name} calendar`"
            @click="startCalendarEdit(calendar)"
          >
            <Pencil :size="14" />
          </button>
          <button
            v-if="calendar.source === 'google' && editingCalendarId !== calendar.id"
            class="text-xs text-slate-500 hover:text-slate-950 dark:hover:text-white"
            type="button"
            @click="toggleCalendar(calendar)"
          >
            {{ calendar.selected ? 'Visible' : 'Hidden' }}
          </button>
          <span
            v-if="calendar.is_default && editingCalendarId !== calendar.id"
            class="text-[10px] uppercase tracking-wide text-slate-400"
            >Default</span
          >
          <button
            v-if="
              !calendar.is_default &&
              calendar.source === 'native' &&
              editingCalendarId !== calendar.id
            "
            class="icon-button hover:!text-rose-600"
            type="button"
            :aria-label="`Delete ${calendar.name} calendar`"
            @click="store.removeCalendar(calendar)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
    </section>

    <div
      v-if="eventFormOpen"
      class="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      @keydown.esc="eventFormOpen = false"
    >
      <button
        class="absolute inset-0 bg-slate-950/30"
        type="button"
        aria-label="Close event form"
        @click="eventFormOpen = false"
      />
      <form
        class="relative z-10 my-auto grid w-full max-w-4xl gap-4 border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-2 lg:grid-cols-6"
        :aria-label="editingEvent ? 'Edit event' : 'New event'"
        @submit.prevent="saveEvent"
      >
        <div class="flex items-start justify-between gap-4 sm:col-span-2 lg:col-span-6">
          <div>
            <h2 class="text-lg font-semibold">{{ editingEvent ? 'Edit event' : 'New event' }}</h2>
            <p class="mt-1 text-sm text-slate-500">Plan time on your calendar.</p>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close"
            @click="eventFormOpen = false"
          >
            <X :size="18" />
          </button>
        </div>
        <label class="sm:col-span-2">
          <span class="field-label">Title</span>
          <input v-model="eventTitle" class="field-input" required maxlength="240" autofocus />
        </label>
        <label>
          <span class="field-label">Save to</span>
          <select v-model="eventCalendarId" class="field-input" required>
            <option v-for="calendar in store.calendars" :key="calendar.id" :value="calendar.id">
              {{ calendar.name }} ·
              {{ calendar.source === 'google' ? 'Google Calendar' : 'Prosepect only' }}
            </option>
          </select>
          <span class="mt-1 block text-[11px] text-slate-400">
            Google Calendar changes normally synchronize within seconds.
          </span>
        </label>
        <label>
          <span class="field-label">Starts</span>
          <input
            v-model="eventStart"
            class="field-input"
            type="datetime-local"
            step="900"
            required
          />
        </label>
        <label>
          <span class="field-label">Ends</span>
          <input
            v-model="eventEnd"
            class="field-input"
            type="datetime-local"
            step="900"
            :min="eventStart"
            required
          />
          <span v-if="eventDraftDurationLabel" class="mt-1 block text-[11px] text-slate-400">
            Duration {{ eventDraftDurationLabel }}
          </span>
        </label>
        <label>
          <span class="field-label">Repeat</span>
          <select v-model="eventRecurrence" class="field-input">
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label v-if="eventRecurrence !== 'none'">
          <span class="field-label">Repeat until</span>
          <input v-model="eventRecurrenceUntil" class="field-input" type="datetime-local" />
        </label>
        <label class="flex items-center gap-2 pt-6 text-sm">
          <input v-model="eventAllDay" type="checkbox" /> All day
        </label>
        <label class="sm:col-span-2 lg:col-span-3">
          <span class="field-label">Location</span>
          <input v-model="eventLocation" class="field-input" maxlength="500" />
        </label>
        <label class="sm:col-span-2 lg:col-span-3">
          <span class="field-label">Attendees</span>
          <input
            v-model="eventAttendees"
            class="field-input"
            placeholder="alex@example.com, sam@example.com"
          />
        </label>
        <label class="sm:col-span-2 lg:col-span-6">
          <span class="field-label">Description</span>
          <textarea
            v-model="eventDescription"
            class="field-input min-h-20 py-2"
            maxlength="10000"
          />
        </label>
        <div v-if="editingEvent" class="sm:col-span-2 lg:col-span-6">
          <AttachmentPanel kind="event" :parent-id="editingEvent.id" />
        </div>
        <div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button
            v-if="editingEvent"
            class="secondary-button !text-rose-600 hover:!border-rose-300 dark:!text-rose-400"
            type="button"
            :disabled="store.saving"
            @click="deleteEditedEvent"
          >
            <Trash2 :size="15" />
            {{ eventDeleteArmed ? 'Confirm delete' : 'Delete event' }}
          </button>
          <div class="ml-auto flex gap-2">
            <button class="secondary-button" type="button" @click="eventFormOpen = false">
              Cancel
            </button>
            <button
              class="primary-button"
              type="submit"
              :disabled="store.saving || !eventDraftDurationMinutes"
            >
              {{ editingEvent ? 'Save event' : 'Create event' }}
            </button>
          </div>
        </div>
      </form>
    </div>

    <div v-if="viewMode === 'month'" class="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section class="min-w-0" :aria-label="monthLabel">
        <h2 class="mb-4 text-sm font-semibold">{{ monthLabel }}</h2>
        <div class="grid grid-cols-7 border-l border-t border-slate-200 dark:border-slate-800">
          <div
            v-for="weekday in weekdays"
            :key="weekday"
            class="border-b border-r border-slate-200 px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800"
          >
            {{ weekday }}
          </div>
          <button
            v-for="date in calendarDays"
            :key="dateKey(date)"
            class="min-h-20 overflow-hidden border-b border-r border-slate-200 p-1.5 text-left align-top transition hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 dark:border-slate-800 dark:hover:bg-slate-900 sm:min-h-28 sm:p-2"
            :class="{
              'bg-slate-50 dark:bg-slate-900': sameDay(date, selectedDate),
              'text-slate-300 dark:text-slate-700': date.getMonth() !== monthCursor.getMonth(),
            }"
            type="button"
            :aria-label="accessibleDateLabel(date)"
            :aria-pressed="sameDay(date, selectedDate)"
            @click="selectDate(date)"
            @dragover.prevent
            @drop.stop="dropEvent(date, $event)"
          >
            <span
              class="grid size-6 place-items-center rounded-full text-xs tabular-nums"
              :class="{
                'bg-slate-950 text-white dark:bg-white dark:text-slate-950': sameDay(date, today),
              }"
            >
              {{ date.getDate() }}
            </span>
            <span class="mt-1 flex gap-1 sm:hidden">
              <span
                v-for="event in eventsForDate(date).slice(0, 2)"
                :key="event.id"
                class="size-1 rounded-full"
                :style="{ backgroundColor: calendarFor(event)?.color }"
              />
              <span
                v-for="task in tasksForDate(date).slice(0, 2)"
                :key="task.id"
                class="size-1 rounded-full bg-slate-500"
              />
            </span>
            <span class="mt-1 hidden space-y-0.5 sm:block">
              <span
                v-for="event in eventsForDate(date).slice(0, 2)"
                :key="event.id"
                class="block cursor-grab truncate rounded px-1 text-[10px] leading-4 text-slate-700 dark:text-slate-200"
                :style="{ borderLeft: `2px solid ${calendarFor(event)?.color ?? '#64748b'}` }"
                draggable="true"
                @dragstart="$event.dataTransfer?.setData('text/prosepect-event', event.id)"
              >
                {{ eventTime(event) }} {{ event.title }}
              </span>
              <span
                v-for="task in tasksForDate(date).slice(
                  0,
                  Math.max(0, 2 - eventsForDate(date).length),
                )"
                :key="task.id"
                class="block truncate px-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400"
                :class="{ 'line-through opacity-50': task.status === 'completed' }"
              >
                {{ task.title }}
              </span>
            </span>
          </button>
        </div>
      </section>

      <section class="min-w-0">
        <div class="border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 class="text-sm font-semibold">{{ selectedLabel }}</h2>
          <p class="mt-1 text-xs text-slate-400">
            {{ selectedEvents.length }} events · {{ selectedTasks.length }} tasks
          </p>
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-900">
          <article
            v-for="event in selectedEvents"
            :key="event.id"
            class="group flex items-start gap-3 py-3"
          >
            <span
              class="mt-1 size-2 rounded-full"
              :style="{ backgroundColor: calendarFor(event)?.color }"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ event.title }}</p>
              <p class="mt-0.5 text-xs text-slate-400">
                {{ eventTime(event) }}<span v-if="event.location"> · {{ event.location }}</span>
              </p>
            </div>
            <button
              class="icon-button !size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              type="button"
              :aria-label="`Edit ${event.title}`"
              @click="openEventEditor(event)"
            >
              <Pencil :size="14" />
            </button>
            <button
              class="icon-button !size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              type="button"
              :aria-label="`Delete ${event.title}`"
              @click="store.removeEvent(event)"
            >
              <Trash2 :size="14" />
            </button>
          </article>
        </div>
        <div class="py-2">
          <TaskList
            :tasks="selectedTasks"
            :projects="store.projects"
            empty-message="Nothing scheduled."
          />
        </div>
      </section>
    </div>

    <section
      v-else-if="viewMode === 'week'"
      class="mt-10 grid gap-px bg-slate-200 dark:bg-slate-800 md:grid-cols-7"
    >
      <div
        v-for="date in weekDays"
        :key="dateKey(date)"
        class="min-h-48 bg-white p-3 dark:bg-slate-950"
        @dragover.prevent
        @drop="dropEvent(date, $event)"
      >
        <button class="text-left" type="button" @click="selectDate(date)">
          <span class="block text-[10px] uppercase text-slate-400">{{
            weekdays[(date.getDay() + 6) % 7]
          }}</span>
          <span class="mt-1 block text-sm font-semibold">{{ date.getDate() }}</span>
        </button>
        <div class="mt-4 space-y-2">
          <button
            v-for="event in eventsForDate(date)"
            :key="event.id"
            class="block w-full cursor-grab truncate border-l-2 px-2 py-1 text-left text-xs"
            :style="{ borderColor: calendarFor(event)?.color }"
            type="button"
            draggable="true"
            @dragstart="$event.dataTransfer?.setData('text/prosepect-event', event.id)"
            @click="openEventEditor(event)"
          >
            <span class="mr-1 text-slate-400">{{ eventTime(event) }}</span>
            <span>{{ event.title }}</span>
          </button>
          <p
            v-for="task in tasksForDate(date)"
            :key="task.id"
            class="truncate px-2 text-xs text-slate-500"
          >
            {{ task.title }}
          </p>
        </div>
      </div>
    </section>

    <section v-else-if="viewMode === 'day'" class="mt-8 min-w-0">
      <div
        class="grid grid-cols-[4rem_1fr] items-center border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
      >
        <div class="border-r border-slate-200 py-3 text-center dark:border-slate-800">
          <span class="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {{ selectedWeekday }}
          </span>
          <span class="mt-0.5 block text-xl font-semibold tabular-nums">
            {{ selectedDate.getDate() }}
          </span>
        </div>
        <div class="flex min-w-0 items-center justify-between gap-4 px-4">
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold">{{ selectedLabel }}</h2>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Click to create · drag to move or delete · drag either edge to resize.
            </p>
          </div>
          <span class="shrink-0 text-xs tabular-nums text-slate-400">
            {{ selectedEvents.length }} events · {{ selectedTasks.length }} tasks
          </span>
        </div>
      </div>

      <div
        v-if="allDayEvents.length"
        class="grid grid-cols-[4rem_1fr] border-x border-b border-slate-200 py-2 dark:border-slate-800"
      >
        <span class="pt-1 text-[10px] uppercase tracking-wide text-slate-400">All day</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="event in allDayEvents"
            :key="event.id"
            class="rounded-sm border-l-2 px-2.5 py-1.5 text-left text-xs font-medium transition hover:brightness-95 dark:hover:brightness-110"
            :style="{
              borderColor: calendarFor(event)?.color,
              backgroundColor: colorTint(calendarFor(event)?.color ?? '#64748b'),
            }"
            type="button"
            @click="openEventEditor(event)"
          >
            {{ event.title }}
          </button>
        </div>
      </div>

      <div
        class="mt-3 min-h-[32rem] max-h-[calc(100vh-17rem)] overflow-y-auto border border-slate-200 bg-white overscroll-contain dark:border-slate-800 dark:bg-slate-950"
        :aria-label="`${selectedLabel}, 24 hour timeline`"
      >
        <div class="relative overflow-hidden" :style="{ height: `${timelineHeight}px` }">
          <div
            class="pointer-events-none absolute left-16 right-0 bg-slate-50/35 dark:bg-slate-900/20"
            :style="{
              top: `${8 * timelineHourHeight}px`,
              height: `${10 * timelineHourHeight}px`,
            }"
          />
          <div
            class="pointer-events-none absolute inset-y-0 left-0 w-16 border-r border-slate-100 bg-slate-50/70 dark:border-slate-900 dark:bg-slate-900/30"
          />
          <span
            v-for="tick in timelineHalfHours"
            :key="tick"
            class="pointer-events-none absolute left-16 right-0 border-t"
            :class="
              tick % 2
                ? 'border-dashed border-slate-100 dark:border-slate-900'
                : 'border-slate-200 dark:border-slate-800'
            "
            :style="{ top: `${(tick * timelineHourHeight) / 2}px` }"
          />
          <button
            v-for="hour in timelineHours"
            :key="hour"
            class="group absolute left-16 right-0 z-0 text-left transition hover:bg-slate-50/60 disabled:pointer-events-none dark:hover:bg-slate-900/40"
            :class="hour === 24 ? 'h-px' : 'h-12'"
            :style="{ top: `${hour * timelineHourHeight}px` }"
            type="button"
            :disabled="hour === 24"
            :aria-label="
              hour < 24 ? `Create scheduled task at ${timelineHourLabel(hour)}` : undefined
            "
            @click="openScheduledTaskAtHour(hour)"
          >
            <time
              class="pointer-events-none absolute -left-14 text-[10px] font-medium tabular-nums text-slate-400"
              :class="{
                'top-1': hour === 0,
                'top-0 -translate-y-1/2': hour > 0 && hour < 24,
                'top-0 -translate-y-full': hour === 24,
              }"
            >
              {{ timelineHourLabel(hour) }}
            </time>
          </button>

          <div
            v-if="currentTimeOffset !== null"
            class="pointer-events-none absolute left-16 right-0 z-30 border-t border-rose-500"
            :style="{ top: `${currentTimeOffset}px` }"
          >
            <span class="absolute -left-1 -top-1 size-2 rounded-full bg-rose-500" />
          </div>

          <div
            v-if="!timelineItems.length && !allDayEvents.length"
            class="pointer-events-none absolute left-20 right-4 z-[5] text-center"
            :style="{ top: `${9 * timelineHourHeight}px` }"
          >
            <p class="text-xs font-medium text-slate-400">No events scheduled</p>
            <p class="mt-1 text-[11px] text-slate-300 dark:text-slate-600">Your day is clear.</p>
          </div>

          <div class="pointer-events-none absolute inset-y-0 left-[4.5rem] right-1">
            <template v-for="item in timelineItems" :key="item.key">
              <button
                v-if="item.event"
                class="group pointer-events-auto absolute z-10 touch-none cursor-grab overflow-hidden rounded-sm border-l-[3px] text-left shadow-sm transition hover:brightness-95 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:brightness-110"
                :class="[
                  { 'opacity-40': draggedTimelineItemKey === item.key },
                  timelineItemIsCompact(item) ? 'px-2 py-1' : 'px-2.5 py-1.5',
                ]"
                :style="timelineItemStyle(item)"
                type="button"
                :aria-label="`Edit ${item.title}, ${timelineTimeRange(item)}. Drag to move.`"
                @pointerdown="startTimelineMove(item, $event)"
                @click="openTimelineEvent(item)"
              >
                <span
                  class="absolute inset-x-0 top-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                  title="Drag top edge to trim"
                  @pointerdown="startTimelineResize(item, $event, 'start')"
                >
                  <span
                    class="absolute left-1/2 top-0.5 h-px w-6 -translate-x-1/2 bg-current opacity-40"
                  />
                </span>
                <span
                  v-if="timelineItemIsCompact(item)"
                  class="flex min-w-0 items-center gap-1 overflow-hidden leading-4"
                >
                  <time class="shrink-0 text-[10px] tabular-nums opacity-65">
                    {{ timelineTimeRange(item) }}
                  </time>
                  <span class="truncate text-[11px] font-semibold">{{ item.title }}</span>
                </span>
                <template v-else>
                  <span class="block truncate text-[11px] font-semibold">{{ item.title }}</span>
                  <span class="block truncate text-[10px] opacity-65">
                    <time>{{ timelineTimeRange(item) }}</time>
                    <template v-if="item.event.location"> · {{ item.event.location }}</template>
                  </span>
                </template>
                <span
                  class="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                  title="Drag bottom edge to resize"
                  @pointerdown="startTimelineResize(item, $event, 'end')"
                >
                  <span
                    class="absolute bottom-0.5 left-1/2 h-px w-6 -translate-x-1/2 bg-current opacity-40"
                  />
                </span>
              </button>
              <button
                v-else
                class="group pointer-events-auto absolute z-10 touch-none cursor-grab overflow-hidden rounded-sm border-l-[3px] text-left shadow-sm transition hover:brightness-95 active:cursor-grabbing dark:hover:brightness-110"
                :class="[
                  { 'opacity-40': draggedTimelineItemKey === item.key },
                  timelineItemIsCompact(item) ? 'px-2 py-1' : 'px-2.5 py-1.5',
                ]"
                :style="timelineItemStyle(item)"
                type="button"
                :aria-label="`${item.title}, scheduled task, ${timelineTimeRange(item)}. Drag to move.`"
                @pointerdown="startTimelineMove(item, $event)"
              >
                <span
                  class="absolute inset-x-0 top-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                  title="Drag top edge to trim"
                  @pointerdown="startTimelineResize(item, $event, 'start')"
                >
                  <span
                    class="absolute left-1/2 top-0.5 h-px w-6 -translate-x-1/2 bg-current opacity-40"
                  />
                </span>
                <span
                  v-if="timelineItemIsCompact(item)"
                  class="flex min-w-0 items-center gap-1 overflow-hidden leading-4"
                >
                  <time class="shrink-0 text-[10px] tabular-nums opacity-65">
                    {{ timelineTimeRange(item) }}
                  </time>
                  <span class="truncate text-[11px] font-semibold">{{ item.title }}</span>
                </span>
                <template v-else>
                  <span class="block truncate text-[11px] font-semibold">{{ item.title }}</span>
                  <span class="block truncate text-[10px] opacity-65">
                    <time>{{ timelineTimeRange(item) }}</time> · task
                  </span>
                </template>
                <span
                  class="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                  title="Drag bottom edge to resize"
                  @pointerdown="startTimelineResize(item, $event, 'end')"
                >
                  <span
                    class="absolute bottom-0.5 left-1/2 h-px w-6 -translate-x-1/2 bg-current opacity-40"
                  />
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>

      <div
        v-if="draggedTimelineItemKey"
        ref="timelineDeleteZone"
        class="pointer-events-none fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 border px-5 py-3 text-sm font-semibold shadow-xl transition"
        :class="
          timelineDeleteActive
            ? 'scale-105 border-rose-600 bg-rose-600 text-white'
            : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
        "
      >
        <Trash2 :size="17" />
        {{ timelineDeleteActive ? 'Release to delete' : 'Drop here to delete' }}
      </div>

      <p class="sr-only" aria-live="polite">{{ timelineAnnouncement }}</p>

      <section v-if="untimedTasks.length" class="mt-6">
        <h3 class="border-b border-slate-200 pb-3 text-xs font-semibold dark:border-slate-800">
          Tasks
        </h3>
        <TaskList :tasks="untimedTasks" :projects="store.projects" empty-message="" />
      </section>
    </section>

    <section v-else class="mt-10 max-w-4xl">
      <h2 class="sr-only">Agenda</h2>
      <div
        v-for="date in agendaDays"
        :key="dateKey(date)"
        class="grid border-b border-slate-200 py-5 dark:border-slate-800 sm:grid-cols-[10rem_1fr]"
      >
        <h3 class="text-sm font-semibold">
          {{
            new Intl.DateTimeFormat(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }).format(date)
          }}
        </h3>
        <div class="mt-3 space-y-2 sm:mt-0">
          <p v-for="event in eventsForDate(date)" :key="event.id" class="text-sm">
            <span class="mr-3 text-xs text-slate-400">{{ eventTime(event) }}</span>
            <span>{{ event.title }}</span>
          </p>
          <p v-for="task in tasksForDate(date)" :key="task.id" class="text-sm text-slate-500">
            {{ task.title }}
          </p>
        </div>
      </div>
      <p v-if="!agendaDays.length" class="py-16 text-center text-sm text-slate-400">
        No upcoming events or tasks.
      </p>
    </section>
  </div>
</template>
