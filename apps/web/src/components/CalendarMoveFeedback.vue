<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { X } from '@lucide/vue'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const feedback = ref<HTMLElement | null>(null)

function undo(event: MouseEvent) {
  // The button is disabled while pending and removed on success. Move keyboard
  // focus to the surviving status region now, never after an async response.
  if (document.activeElement === event.currentTarget) feedback.value?.focus()
  void store.undoCalendarMove()
}

function dismiss(event: MouseEvent) {
  if (document.activeElement === event.currentTarget)
    document.getElementById('workspace-content')?.focus()
  store.dismissCalendarMoveFeedback()
}

const now = ref(Date.now())
const timer = window.setInterval(() => (now.value = Date.now()), 1_000)
onBeforeUnmount(() => window.clearInterval(timer))
const expired = computed(() =>
  Boolean(store.calendarMoveUndo && Date.parse(store.calendarMoveUndo.expires_at) <= now.value),
)
const message = computed(() => {
  if (store.calendarMoveUndoing) return 'Undoing calendar move…'
  if (store.calendarMovePending) return 'Saving calendar move…'
  if (expired.value) return 'Undo expired. Calendar move kept.'
  return store.calendarMoveMessage
})
</script>

<template>
  <section
    v-if="store.calendarMoveUndo || message || store.calendarMoveError"
    ref="feedback"
    tabindex="-1"
    aria-label="Calendar move Undo"
    :aria-busy="store.calendarMovePending"
    class="fixed bottom-4 left-4 right-4 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
  >
    <div class="min-w-0 flex-1">
      <p role="status" aria-live="polite" aria-atomic="true">{{ message }}</p>
      <p
        v-if="store.calendarMoveUndo && !expired"
        class="text-xs text-slate-500 dark:text-slate-400"
      >
        Undo available for 60 seconds after the move.
      </p>
      <p v-if="store.calendarMoveError" role="alert" class="mt-1 text-rose-700 dark:text-rose-300">
        {{ store.calendarMoveError }}
      </p>
    </div>
    <button
      v-if="store.calendarMoveUndo"
      type="button"
      class="button-secondary min-h-11 shrink-0"
      :disabled="expired || store.calendarMovePending || store.saving"
      @click="undo"
    >
      {{ store.calendarMoveUndoing ? 'Undoing…' : 'Undo' }}
    </button>
    <button
      type="button"
      class="icon-button min-h-11 min-w-11 shrink-0"
      aria-label="Dismiss calendar move feedback"
      :disabled="store.calendarMovePending"
      @click="dismiss"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </section>
</template>
