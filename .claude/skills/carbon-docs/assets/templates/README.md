# Templates

Turnkey, copy-in files for the Carbon docs app. They already encode the Carbon brand (tokens, Geist,
dark mode) and the cofounder editorial aesthetic. Adapt them; don't rewrite from scratch.

## What's here

| File | Copy to | Purpose |
|------|---------|---------|
| `global.css` | `apps/docs/app/global.css` | Tailwind v4 + Geist + Carbon tokens + Fumadocs var mapping + baked default theme (light/dark) + editorial rhythm |
| `components/reading-progress.tsx` | `apps/docs/components/` | Right-edge tick ruler that fills with scroll (Guide layout) |
| `components/scroll-reveal.tsx` | `apps/docs/components/` | Fade/rise sections in on scroll (MDX); honors reduced-motion |
| `components/chapter-nav.tsx` | `apps/docs/components/` | Roman-numeral chapter + connected step-dot rail (Guide layout) |
| `components/feature-callout.tsx` | `apps/docs/components/` | Two-column "bridge to product" card with CTA (MDX) |
| `components/checklist.tsx` | `apps/docs/components/` | Stateful, tickable checklist persisted per page (MDX) |
| `components/frame.tsx` | `apps/docs/components/` | Rounded, bordered media frame with caption (MDX) |
| `components/prose.tsx` | `apps/docs/components/` | `Eyebrow` chapter pill and other small editorial primitives (MDX) |

## Wiring

1. **Styles.** Copy `global.css` to `apps/docs/app/global.css` and import it in `app/layout.tsx`.
   Re-check the baked `:root`/`.dark` values against `packages/utils/src/themes.ts` (the `zinc`/"Modern"
   default) in case the palette changed. Adjust the three `fumadocs-ui/css/*` imports and `@source` lines
   to the current Fumadocs Tailwind-v4 setup if the build can't find styles.
2. **Components.** Copy the whole `components/` folder to `apps/docs/components/`.
3. **Register MDX components.** In `mdx-components.tsx`, add the bespoke components to the map (see
   `references/components.md` for the exact block). `ScrollReveal`, `FeatureCallout`, `Checklist`,
   `Check`, `Frame`, and `Eyebrow` are used inside MDX.
4. **Mount layout pieces.** `ReadingProgress` and `ChapterNav` belong in the **Guide layout**
   (`app/docs/layout.tsx` or a dedicated guide layout), not inside MDX. Feed `ChapterNav` a `chapters`
   array derived from `source.pageTree` so it tracks `meta.json`.

## Assumptions / dependencies

- **React 18** (the monorepo catalog), `framer-motion` (in the catalog), `next` (App Router), Tailwind v4.
- `--color-brand` is defined in `global.css`, so `text-brand` / `bg-brand` / `bg-brand/10` work.
- Components use only Carbon design tokens (`text-foreground`, `bg-card`, `border-border`, …) and `brand`
  — no hardcoded hex — so they adapt to light/dark automatically.
- `not-prose` is applied where a component shouldn't inherit Fumadocs' MDX prose styles.

These are starting points sized for clarity. Tune spacing, tick counts, and easing to taste once you see
them rendered — then screenshot against the cofounder reference (see `references/design-language.md`).
