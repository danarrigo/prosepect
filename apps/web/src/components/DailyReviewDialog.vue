<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { ReviewDecisionAction } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const dismissedReviewId = ref<string | null>(null)
const actions = ref<Record<string, ReviewDecisionAction>>({})
const rescheduleDates = ref<Record<string, string>>({})
const visible = computed(
  () => store.dailyReview && store.dailyReview.id !== dismissedReviewId.value,
)
const canComplete = computed(() =>
  Boolean(
    store.dailyReview?.unfinished_tasks.every(
      (task) =>
        actions.value[task.id] &&
        (actions.value[task.id] !== 'reschedule' || rescheduleDates.value[task.id]),
    ),
  ),
)

watch(
  () => store.dailyReview,
  (review) => {
    if (!review) return
    actions.value = Object.fromEntries(
      review.unfinished_tasks.map((task) => [task.id, 'carry_forward' as const]),
    )
    rescheduleDates.value = {}
  },
  { immediate: true },
)

async function completeReview() {
  const review = store.dailyReview
  if (!review || !canComplete.value) return
  await store.completeDailyReview(
    review.unfinished_tasks.map((task) => ({
      task_id: task.id,
      action: actions.value[task.id]!,
      due_at:
        actions.value[task.id] === 'reschedule'
          ? new Date(`${rescheduleDates.value[task.id]}T23:59:00`).toISOString()
          : null,
    })),
  )
}
</script>

<template>
  <div
    v-if="visible && store.dailyReview"
    class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4 backdrop-blur-[1px]"
    role="presentation"
  >
    <section
      class="my-auto w-full max-w-xl rounded-lg bg-white p-6 shadow-2xl dark:bg-slate-950 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-review-heading"
      @keydown.esc="dismissedReviewId = store.dailyReview?.id ?? null"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Daily review
          </p>
          <h2 id="daily-review-heading" class="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            What should move forward?
          </h2>
          <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Decide what to do with yesterday's unfinished focus tasks.
          </p>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Review later"
          @click="dismissedReviewId = store.dailyReview?.id ?? null"
        >
          <X :size="18" />
        </button>
      </div>

      <form class="mt-7" @submit.prevent="completeReview">
        <fieldset
          v-for="task in store.dailyReview.unfinished_tasks"
          :key="task.id"
          class="border-t border-slate-200 py-5 first:border-t-0 dark:border-slate-800"
        >
          <legend class="mb-3 text-sm font-medium">{{ task.title }}</legend>
          <div class="grid gap-2 sm:grid-cols-3">
            <label
              v-for="option in [
                ['carry_forward', 'Carry forward'],
                ['reschedule', 'Reschedule'],
                ['remove', 'Remove'],
              ] as const"
              :key="option[0]"
              class="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
            >
              <input v-model="actions[task.id]" type="radio" :name="task.id" :value="option[0]" />
              {{ option[1] }}
            </label>
          </div>
          <label v-if="actions[task.id] === 'reschedule'" class="mt-3 block">
            <span class="field-label">New deadline</span>
            <input v-model="rescheduleDates[task.id]" class="field-input" type="date" required />
          </label>
        </fieldset>

        <div
          class="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-5 dark:border-slate-800"
        >
          <button
            class="secondary-button"
            type="button"
            @click="dismissedReviewId = store.dailyReview?.id ?? null"
          >
            Review later
          </button>
          <button class="primary-button" type="submit" :disabled="!canComplete">
            Complete review
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
