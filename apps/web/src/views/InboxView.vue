<script setup lang="ts">
import { computed, ref } from 'vue'
import QuickTaskForm from '../components/QuickTaskForm.vue'
import TaskList from '../components/TaskList.vue'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const capture = ref<InstanceType<typeof QuickTaskForm> | null>(null)
const tasks = computed(() =>
  store.tasks.filter((task) => !task.project_id && task.status !== 'completed'),
)
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-8 px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">Inbox</h1>
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Capture tasks here. Assign a project or complete them when ready.
      </p>
    </header>
    <QuickTaskForm ref="capture" :default-project-id="null" />
    <section aria-label="Inbox tasks">
      <TaskList
        :tasks="tasks"
        :projects="store.projects"
        :reorderable="false"
        focusable
        empty-message="Your inbox is clear."
        @focus-lost="capture?.focusTitle()"
      />
    </section>
  </div>
</template>
