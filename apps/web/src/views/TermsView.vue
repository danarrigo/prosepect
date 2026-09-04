<script setup lang="ts">
import { RouterLink } from 'vue-router'
import PublicPageShell from '../components/PublicPageShell.vue'
</script>

<template>
  <PublicPageShell
    title="Terms of Service"
    summary="The rules that apply when you access or use the hosted Prosepect service."
    last-updated="September 4, 2026"
  >
    <section>
      <h2>1. Agreement</h2>
      <p>
        These Terms govern your use of the hosted Prosepect service operated independently by Daniel
        in Indonesia. By creating an account or using the service, you agree to these Terms and the
        <RouterLink to="/privacy">Privacy Policy</RouterLink>. If you do not agree, do not use the
        service.
      </p>
    </section>

    <section>
      <h2>2. Eligibility and accounts</h2>
      <p>
        You must be at least 18 years old and legally capable of entering this agreement. You must
        provide accurate account information, keep control of your Google account, and promptly
        report suspected unauthorized access. You are responsible for activity performed through
        your account unless applicable law provides otherwise.
      </p>
      <p>
        Access may be limited during testing or when service capacity is reached. An account is for
        one person and may not be transferred or used to bypass account, rate, or storage limits.
      </p>
    </section>

    <section>
      <h2>3. The service</h2>
      <p>
        Prosepect provides personal task, project, note, calendar, attachment, import, export, and
        daily-planning tools. Features may change as the service is improved. Reasonable notice will
        be provided when a material change would significantly reduce core functionality or affect
        how personal data is processed.
      </p>
      <p>
        The hosted service is currently provided without charge. This does not guarantee that every
        feature or capacity level will remain free indefinitely. Prosepect will not impose a charge
        without clearly presenting the price and obtaining any consent required by law.
      </p>
    </section>

    <section>
      <h2>4. Google services</h2>
      <p>
        Google sign-in is required for the hosted service. Google Calendar connection is optional
        and uses incremental authorization. If enabled, you instruct Prosepect to read and
        synchronize calendar information and to create, update, or delete Google events for the
        features you use.
      </p>
      <p>
        Your use of Google services remains subject to Google's terms and policies. You can
        disconnect Google Calendar in Prosepect Settings or revoke authorization from your Google
        Account. Changes made in Prosepect may change or delete synchronized events in Google, and
        changes made in Google may change Prosepect records according to your synchronization
        settings.
      </p>
    </section>

    <section>
      <h2>5. Your content</h2>
      <p>
        You retain ownership of content you enter or upload. You grant Prosepect a limited right to
        host, process, reproduce, and transmit that content only as needed to operate, secure, and
        improve the user-facing service you request and to comply with law.
      </p>
      <p>
        You are responsible for having the right to store and synchronize your content, including
        personal data about attendees or other people. Do not use Prosepect to store unlawful
        content or highly sensitive information when loss or disclosure could cause severe harm.
      </p>
    </section>

    <section>
      <h2>6. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>use the service unlawfully or violate another person's rights;</li>
        <li>upload malware or content designed to damage or disrupt systems;</li>
        <li>attempt unauthorized access, security testing, or credential interception;</li>
        <li>
          scrape, overload, or automate the hosted service in a manner that harms other users;
        </li>
        <li>circumvent storage, request, account, or provider limits;</li>
        <li>use the service to distribute spam, harassment, or deceptive content; or</li>
        <li>use another person's Google data without authorization.</li>
      </ul>
      <p>
        Responsible security reports are welcome at
        <a href="mailto:daniel.manurung.dev@gmail.com">daniel.manurung.dev@gmail.com</a>. Do not
        access, retain, or disclose another user's data while investigating a problem.
      </p>
    </section>

    <section>
      <h2>7. Service limits and availability</h2>
      <p>
        Prosepect may enforce file-size, storage, request, synchronization, and account-capacity
        limits to protect the service and control operating costs. Requests may be delayed or
        rejected when a limit is reached.
      </p>
      <p>
        The service depends on external providers, including Google, Vercel, Render, Neon, and
        Cloudflare. Interruptions, delayed synchronization, provider limits, maintenance, or feature
        changes may affect availability. Prosepect will make reasonable efforts to preserve data and
        restore service but does not promise uninterrupted or error-free operation.
      </p>
    </section>

    <section>
      <h2>8. Exports and backups</h2>
      <p>
        Prosepect provides data-export tools, and you should periodically export information that is
        important to you. Service backups are intended for operational disaster recovery and are not
        a substitute for your own copies. Backup restoration may restore the service as a whole and
        may not support recovery of one item or one account.
      </p>
    </section>

    <section>
      <h2>9. Suspension and termination</h2>
      <p>
        You may stop using Prosepect, disconnect Google Calendar, export data, or delete your
        account through Settings. Prosepect may restrict or suspend access when reasonably necessary
        to address abuse, security risks, legal requirements, serious or repeated violations of
        these Terms, or service-capacity limits.
      </p>
      <p>
        When practical, notice and an opportunity to export data will be provided before a
        non-urgent termination. Immediate action may be taken when needed to prevent harm, comply
        with law, or protect users and infrastructure.
      </p>
    </section>

    <section>
      <h2>10. Open-source software</h2>
      <p>
        Prosepect's source code is available under the GNU Affero General Public License version 3.
        The software license governs use, copying, and modification of the source code. These Terms
        separately govern access to the hosted service at prosepect.com.
      </p>
    </section>

    <section>
      <h2>11. Disclaimers</h2>
      <p>
        To the maximum extent permitted by applicable law, the hosted service is provided on an "as
        is" and "as available" basis without warranties of uninterrupted availability, fitness for a
        particular purpose, or freedom from every defect. Nothing in these Terms excludes a warranty
        or consumer right that cannot legally be excluded.
      </p>
    </section>

    <section>
      <h2>12. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by applicable law, the operator is not liable for indirect,
        incidental, special, consequential, or punitive loss, or for loss of profits, opportunity,
        goodwill, or data arising from use of the service. This limitation does not apply where
        liability cannot legally be limited, including liability arising from fraud, intentional
        misconduct, or other non-excludable obligations.
      </p>
    </section>

    <section>
      <h2>13. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the Republic of Indonesia, without limiting any
        mandatory protection available under the law that applies to you. Before filing a claim,
        please contact the operator and allow a reasonable opportunity to resolve the issue. Subject
        to mandatory law, unresolved disputes will be submitted to the competent courts of
        Indonesia.
      </p>
    </section>

    <section>
      <h2>14. Changes and contact</h2>
      <p>
        Material changes to these Terms will be communicated through the service or by another
        appropriate method before they take effect. Continued use after the effective date means you
        accept the revised Terms where permitted by law.
      </p>
      <p>
        Questions can be sent to
        <a href="mailto:daniel.manurung.dev@gmail.com">daniel.manurung.dev@gmail.com</a>.
      </p>
    </section>
  </PublicPageShell>
</template>
