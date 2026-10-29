<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const statusPage = 'https://stats.uptimerobot.com/xz23PeH80u'
const badgeImage = 'https://badge.uptimerobot.com/psp/6c851dc1918fdfff0234f516c3f47135.svg'
const source = ref('')
const image = ref<HTMLImageElement | null>(null)
const loading = ref(false)
const failed = ref(false)
const receivedAt = ref<string | null>(null)
let mounted = false
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let timeout: ReturnType<typeof setTimeout> | undefined
let themeObserver: MutationObserver | undefined

function stop() {
  clearTimeout(timer)
  clearTimeout(timeout)
}

function refresh() {
  stop()
  if (!mounted || document.hidden) return
  loading.value = true
  failed.value = false
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  source.value = `${badgeImage}?style=logo&theme=${theme}&refresh=${++revision}`
  timeout = setTimeout(() => {
    if (!mounted || document.hidden) return
    loading.value = false
    failed.value = true
  }, 15_000)
  timer = setTimeout(refresh, 60_000)
}

function loaded(event: Event, success: boolean) {
  if (!mounted || document.hidden || event.target !== image.value || failed.value) return
  clearTimeout(timeout)
  loading.value = false
  failed.value = !success
  if (success) receivedAt.value = new Date().toLocaleString()
}

function visibilityChanged() {
  if (document.hidden) {
    stop()
    loading.value = false
    failed.value = true
  } else refresh()
}

onMounted(() => {
  mounted = true
  document.addEventListener('visibilitychange', visibilityChanged)
  themeObserver = new MutationObserver(refresh)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  refresh()
})
onBeforeUnmount(() => {
  mounted = false
  stop()
  themeObserver?.disconnect()
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <section
    aria-labelledby="uptime-title"
    class="mt-6 min-w-0 rounded-lg border border-slate-200 p-5 dark:border-slate-800"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="uptime-title" class="text-base font-semibold">External uptime monitoring</h2>
      <button type="button" class="secondary-button" :disabled="loading" @click="refresh">
        {{ loading ? 'Refreshing status…' : 'Refresh external status' }}
      </button>
    </div>
    <a
      :href="statusPage"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-4 inline-block max-w-full rounded focus-visible:outline-2 focus-visible:outline-offset-4"
      aria-label="Open rakkio service status and uptime history"
    >
      <img
        v-if="source"
        v-show="!failed"
        :key="source"
        ref="image"
        :src="source"
        width="181"
        height="24"
        alt="UptimeRobot service status badge; open for monitor details"
        referrerpolicy="no-referrer"
        @load="loaded($event, true)"
        @error="loaded($event, false)"
      />
    </a>
    <p v-if="failed" role="status" class="mt-2 text-sm text-amber-700 dark:text-amber-300">
      External status is unknown. The badge could not be refreshed; use the status page below.
    </p>
    <p v-else class="mt-2 text-xs text-slate-500 dark:text-slate-400">
      {{
        loading
          ? 'Fetching the external badge…'
          : 'Status is reported by UptimeRobot, not by this API.'
      }}
    </p>
    <p v-if="receivedAt" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
      Last badge received: {{ receivedAt }}. This is not the monitor's check time.
    </p>
    <a
      :href="statusPage"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-3 inline-block text-sm font-medium underline underline-offset-4"
      >View uptime history ↗</a
    >
    <p class="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      UptimeRobot checks the hosted website and API independently. This badge refreshes every 60
      seconds while visible. Use the history link if Operations cannot open. Email alert delivery
      still needs verification.
    </p>
  </section>
</template>
