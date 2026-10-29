# rakkio brand

The lowercase wordmark uses outlined Inter SemiBold glyphs for `rakkio`. The standalone icon and adaptive favicon use the same typeface's lowercase `r`.

- `src/components/BrandLogo.vue` renders the wordmark inline with `currentColor`, a single accessible name, and no external font request or duplicate SVG IDs.
- `icon.svg` provides a standalone 96 x 96 icon for provider-specific exports.
- `/favicon.svg` uses the same icon geometry and adapts to the browser's light/dark preference.

The artwork is derived from Inter by The Inter Project Authors (https://github.com/rsms/inter), licensed under SIL OFL 1.1. The complete license is included in `Inter-OFL.txt`. Geometry and accessible naming are covered by `BrandLogo.test.ts`.

The former paragraph-p artwork is retained in Git history, not shipped as the rakkio logo.
