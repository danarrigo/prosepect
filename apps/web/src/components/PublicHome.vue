<script setup lang="ts">
import { RouterLink } from 'vue-router'
import * as api from '../api/client'
</script>

<template>
  <div class="min-h-dvh bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <header class="border-b border-slate-200 dark:border-slate-800">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <span class="text-sm font-semibold tracking-[-0.02em]">Prosepect</span>
        <nav aria-label="Public navigation" class="flex items-center gap-5 text-xs text-slate-500">
          <RouterLink class="hover:text-slate-950 dark:hover:text-white" to="/privacy">
            Privacy
          </RouterLink>
          <RouterLink class="hover:text-slate-950 dark:hover:text-white" to="/terms">
            Terms
          </RouterLink>
          <a
            class="hidden hover:text-slate-950 dark:hover:text-white sm:inline"
            href="https://github.com/danarrigo/prosepect"
            rel="noreferrer"
            target="_blank"
          >
            Source
          </a>
        </nav>
      </div>
    </header>

    <main>
      <section
        class="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center"
      >
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Daily command center
          </p>
          <h1 class="mt-5 max-w-2xl text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">
            Plan what matters without scattering your attention.
          </h1>
          <p class="mt-6 max-w-xl text-base leading-8 text-slate-500 dark:text-slate-400">
            Prosepect brings tasks, projects, notes, priorities, and calendars into one calm
            workspace. Schedule work directly on your day and keep optional Google Calendar
            synchronization under your control.
          </p>
        </div>

        <div class="border-y border-slate-200 py-8 dark:border-slate-800 lg:border lg:p-8">
          <p class="text-sm font-semibold">Open your workspace</p>
          <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Access is currently limited while public-launch safeguards and Google verification are
            completed.
          </p>
          <a
            class="mt-6 inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-950 dark:focus-visible:outline-white"
            :href="api.apiUrl('/api/v1/auth/google/start')"
            aria-label="Sign in with Google"
          >
            <img
              class="h-10 w-[180px] dark:hidden"
              src="/sign-in-with-google-light.png"
              alt="Sign in with Google"
              width="180"
              height="40"
            />
            <img
              class="hidden h-10 w-[180px] dark:block"
              src="/sign-in-with-google-dark.png"
              alt="Sign in with Google"
              width="180"
              height="40"
            />
          </a>
          <p class="mt-5 text-xs leading-5 text-slate-400">
            Sign-in shares your Google account identifier, email, name, and profile image with
            Prosepect. Google Calendar access is optional and requested separately when you connect
            it in Settings. By signing in, you agree to the
            <RouterLink class="underline" to="/terms">Terms</RouterLink> and acknowledge the
            <RouterLink class="underline" to="/privacy">Privacy Policy</RouterLink>.
          </p>
        </div>
      </section>

      <section class="border-t border-slate-200 dark:border-slate-800">
        <div class="mx-auto grid max-w-6xl sm:grid-cols-2 lg:grid-cols-4">
          <article
            class="border-b border-slate-200 px-5 py-9 dark:border-slate-800 sm:border-r sm:px-8 lg:border-b-0"
          >
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Focus</p>
            <h2 class="mt-3 text-sm font-semibold">Choose today's priorities</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Keep the day intentional with focused tasks, reminders, and a lightweight review.
            </p>
          </article>
          <article
            class="border-b border-slate-200 px-5 py-9 dark:border-slate-800 sm:px-8 lg:border-b-0 lg:border-r"
          >
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan</p>
            <h2 class="mt-3 text-sm font-semibold">Put work on the calendar</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Create scheduled tasks from empty time and adjust them in precise 15-minute steps.
            </p>
          </article>
          <article
            class="border-b border-slate-200 px-5 py-9 dark:border-slate-800 sm:border-r sm:px-8 lg:border-b-0"
          >
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Organize</p>
            <h2 class="mt-3 text-sm font-semibold">Connect plans and context</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Keep standalone tasks, projects, notes, files, and calendar events clearly linked.
            </p>
          </article>
          <article class="px-5 py-9 sm:px-8">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Own</p>
            <h2 class="mt-3 text-sm font-semibold">Export or self-host</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Export common formats or run the AGPL-licensed application on your own infrastructure.
            </p>
          </article>
        </div>
      </section>
    </main>

    <footer class="border-t border-slate-200 dark:border-slate-800">
      <div
        class="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"
      >
        <span>Independently operated by Daniel in Indonesia.</span>
        <a
          class="hover:text-slate-950 dark:hover:text-white"
          href="mailto:daniel.manurung.dev@gmail.com"
        >
          daniel.manurung.dev@gmail.com
        </a>
      </div>
    </footer>
  </div>
</template>
