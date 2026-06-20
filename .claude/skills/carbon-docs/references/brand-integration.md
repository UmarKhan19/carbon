# Phase 2 — Brand integration

The difference between "a Fumadocs site" and "Carbon's docs" is entirely in this phase. A default
Fumadocs install ships with its own font and a purple accent. Replace both with Carbon's Geist + token
palette so the docs feel continuous with the ERP/MES/academy apps.

The turnkey result is `assets/templates/global.css` — copy it and you get all of this. This file
explains *why* it's shaped that way so you can adapt it confidently.

## The CSS import chain

Carbon's Vite apps all start their stylesheet the same way (see `apps/mes/app/styles/tailwind.css`):

```css
@import "tailwindcss";
@import "non.geist";        /* Geist Variable        */
@import "non.geist/mono";   /* Geist Mono Variable   */
@import "@carbon/config/tailwind/theme.css";   /* token → utility mapping */
```

The docs app's `app/global.css` does the same, plus two things unique to a Next/Fumadocs app (below).

## Gotcha: the raw token values are injected at runtime in the other apps

`@carbon/config/tailwind/theme.css` only *maps* utilities to variables — e.g.
`--color-primary: hsl(var(--primary))` inside an `@theme inline` block. It does **not** define the raw
`--primary: 220 5.9% 10%` triples. In the ERP/MES/academy apps those raw values are written onto the
`<html>` element **at runtime** by the React Router root route, reading from
`packages/utils/src/themes.ts` (8 themes; the default is `name: "zinc"`, `label: "Modern"`).

A Next.js app has no such root route. So you must **bake the default theme's values statically** into
`global.css`. Pull them from `packages/utils/src/themes.ts` → the `zinc` entry. As of writing, the
default theme is:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 220 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 220 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 220 10% 3.9%;
  --primary: 220 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 220 4.8% 95.9%;
  --secondary-foreground: 220 5.9% 10%;
  --muted: 220 4.8% 95.9%;
  --muted-foreground: 220 3.8% 46.1%;
  --accent: 220 4.8% 95.9%;
  --accent-foreground: 220 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 220 5.9% 90%;
  --input: 220 5.9% 90%;
  --ring: 220 5.9% 10%;
  --success: 142 70% 45%;
  --success-foreground: 0 0% 98%;
  --radius: 0.5rem;
}
.dark {
  /* Vercel/Geist-inspired pure-black base */
  --background: 0 0% 0%;
  --foreground: 0 0% 93%;
  --card: 0 0% 4%;
  --card-foreground: 0 0% 93%;
  --popover: 0 0% 7%;
  --popover-foreground: 0 0% 93%;
  --primary: 0 0% 100%;
  --primary-foreground: 0 0% 0%;
  --secondary: 0 0% 7%;
  --secondary-foreground: 0 0% 93%;
  --muted: 0 0% 15%;
  --muted-foreground: 0 0% 63%;
  --accent: 0 0% 10%;
  --accent-foreground: 0 0% 93%;
  --destructive: 0 100% 64%;
  --destructive-foreground: 0 0% 100%;
  --border: 0 0% 15%;
  --input: 0 0% 15%;
  --ring: 0 0% 35%;
  --success: 152 72% 53%;
  --success-foreground: 0 0% 0%;
}
```

> Re-read these from `packages/utils/src/themes.ts` at scaffold time rather than trusting this snapshot —
> the palette can change, and the docs should track the canonical source. Copying the *mechanism* matters
> more than the exact hex.

If you later want the theme switcher Carbon's apps have, you can port the same runtime injection, but a
docs site rarely needs 8 themes — the default Modern theme in light + dark is the right call.

## Map Fumadocs variables onto Carbon tokens

Fumadocs UI themes itself through `--color-fd-*` CSS variables (background, foreground, primary, muted,
border, card, accent, etc.). Point them at Carbon's tokens so one palette drives everything:

```css
:root {
  --color-fd-background: hsl(var(--background));
  --color-fd-foreground: hsl(var(--foreground));
  --color-fd-muted: hsl(var(--muted));
  --color-fd-muted-foreground: hsl(var(--muted-foreground));
  --color-fd-popover: hsl(var(--popover));
  --color-fd-popover-foreground: hsl(var(--popover-foreground));
  --color-fd-card: hsl(var(--card));
  --color-fd-card-foreground: hsl(var(--card-foreground));
  --color-fd-border: hsl(var(--border));
  --color-fd-primary: hsl(var(--primary));
  --color-fd-primary-foreground: hsl(var(--primary-foreground));
  --color-fd-accent: hsl(var(--accent));
  --color-fd-accent-foreground: hsl(var(--accent-foreground));
  --color-fd-ring: hsl(var(--ring));
}
```

Check the current Fumadocs theme variable names when you wire this (they occasionally add new ones).
The principle holds: every `--color-fd-*` resolves to an `hsl(var(--carbon-token))`.

## Fonts

`non.geist` registers `Geist Variable` and `Geist Mono Variable` as font faces via the `@import`s above,
and `theme.css` already sets `--font-sans`, `--font-mono`, and `--font-headline` to them with
`--tracking-normal: -0.02em`. So you get Carbon's type automatically — just **don't** let Fumadocs or
Next inject a competing `next/font`. If you set a font on `<body>`, use `font-sans`.

For the editorial Guide surface you may want a slightly larger type scale and a serif option for display
headings to get the cofounder "book" feel; see `references/design-language.md`. Keep body text in Geist
for brand consistency — the editorial feel comes from *scale, measure, and rhythm*, not from swapping the
typeface everywhere.

## Dark mode

Both systems use the `.dark` class strategy, so they compose cleanly:
- Fumadocs' `RootProvider` wraps the app and toggles `.dark` on `<html>` via `next-themes`.
- Your baked `.dark { … }` block (above) then supplies the Carbon dark values, which flow into both
  `--color-*` utilities and `--color-fd-*`.

Result: one toggle, one coherent dark theme across Fumadocs chrome and your custom components. Verify the
toggle actually flips both the Fumadocs sidebar *and* your bespoke Guide components.

## Gotcha: Tailwind Typography vs Fumadocs prose

Carbon's `theme.css` includes `@plugin "@tailwindcss/typography"`. That plugin styles `.prose` — and
Fumadocs renders page content inside `<div class="prose ...">` too. The two collide, and Typography's
**fixed gray** color variables win the cascade. The symptom is brutal and easy to miss until you check
dark mode: prose text renders dark-gray regardless of theme, so it's *readable on light but nearly
invisible on dark* (dark gray on black).

The fix (already in `assets/templates/global.css`) is to point Typography's color variables at Carbon
tokens so prose is theme-aware:

```css
.prose {
  --tw-prose-body: hsl(var(--foreground));
  --tw-prose-headings: hsl(var(--foreground));
  --tw-prose-links: hsl(var(--primary));
  --tw-prose-bold: hsl(var(--foreground));
  --tw-prose-bullets: hsl(var(--border));
  --tw-prose-hr: hsl(var(--border));
  --tw-prose-quotes: hsl(var(--foreground));
  --tw-prose-code: hsl(var(--foreground));
  --tw-prose-th-borders: hsl(var(--border));
  --tw-prose-td-borders: hsl(var(--border));
  /* …the rest of the --tw-prose-* set… */
}
```

Always smoke-test a content page in **dark** mode specifically — this bug is invisible in light mode.

## Logo

Carbon's hexagon mark + wordmark exist as light/dark SVGs (e.g. under
`examples/quote-configurator/public/carbon-mark-{light,dark}.svg` and `carbon-word-{light,dark}.svg`).
Copy the appropriate pair into `apps/docs/public/` and use them in the nav title and favicon, switching by
theme. Don't recreate the mark — reuse the canonical asset.

## Reuse `@carbon/react`, don't reinvent

`@carbon/react` (Radix + CVA) already has `Card`, `Alert`, `Tabs`, `Accordion`, `Badge`, `CodeBlock`
(Shiki, `github-dark-default`), `Tooltip`, and more. In MDX/Next:
- These are client components — import them into client component wrappers or add `"use client"`.
- Prefer them over hand-rolled markup, matching the repo-wide rule ("use existing components, prefer
  built-in variants over custom `bg-*`/`text-*`").
- Fumadocs ships its own `Card`, `Callout`, `Tab`, `Steps` etc. that are already theme-variable-driven.
  Use Fumadocs' versions for the Reference surface (they integrate with TOC, search, and MDX cleanly),
  and reach for `@carbon/react` when you need a primitive Fumadocs doesn't have or when matching a
  specific in-app pattern. Don't import both flavors of the same thing on one page — pick the one that
  keeps the page coherent.
