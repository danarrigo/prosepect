<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { X } from '@lucide/vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import SchedulingHelp from './SchedulingHelp.vue'
import QuickTaskForm from './QuickTaskForm.vue'

const open = ref(false)
const taskForm = ref<InstanceType<typeof QuickTaskForm> | null>(null)
const draftKey = ref(0)

function openTaskDialog() {
  if (open.value) return
  draftKey.value += 1
  open.value = true
}

async function focusTaskTitle(event: Event) {
  event.preventDefault()
  await nextTick()
  taskForm.value?.focusTitle()
}

defineExpose({ open: openTaskDialog })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-slate-950/30 data-[state=open]:animate-fade-in" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-slate-200 bg-white p-6 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-950"
        @open-auto-focus="focusTaskTitle"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-lg font-semibold tracking-tight">New task</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Tasks are work you can complete. Add a deadline phrase or choose the details below.
            </DialogDescription>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="open = false">
            <X :size="18" />
          </button>
        </div>

        <div class="mt-6">
          <QuickTaskForm
            v-if="open"
            :key="draftKey"
            ref="taskForm"
            autofocus
            @created="open = false"
          />
        </div>
        <SchedulingHelp />
        <p class="mt-4 text-right text-[11px] text-slate-400">
          <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to create
        </p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
