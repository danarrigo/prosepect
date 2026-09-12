# Prosepect paragraph-p brand

Approved source: `design/paragraph-p-logo`, commit `2691782`, under
`apps/web/public/brand/prototype/`. No prototype preview is shipped.

- `src/components/BrandLogo.vue` compiles the approved integrated wordmark inline
  so `currentColor` follows the application theme, without runtime SVG injection.
  Path data, transforms and viewBox are unchanged from `logo.svg`.
- `icon.svg` is the approved standalone icon geometry (96 × 96), with a production
  accessible name. It can be used as a source for provider-specific icon exports.
- `/favicon.svg` uses the same standalone geometry and switches its foreground
  with the browser's light/dark preference; it does not depend on page CSS.

The outlined wordmark uses Inter by The Inter Project Authors
(https://github.com/rsms/inter), licensed under SIL OFL 1.1.
The complete original license is included in `Inter-OFL.txt`. No font download
is needed to render the logo.
