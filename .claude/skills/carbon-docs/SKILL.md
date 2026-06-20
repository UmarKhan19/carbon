---
name: carbon-docs
description: >-
  Build a beautiful, comprehensive documentation website AND write the documentation that
  lives in it, for the Carbon manufacturing platform — modeled on the editorial guide + structured
  reference patterns of cofounder.co/how-to and docs.cofounder.co. Use this whenever the user
  wants to create or improve docs, a docs site, a documentation portal, a "how-to" or onboarding
  guide, a getting-started flow, API/feature reference pages, or anything destined for docs.carbon.ms
  — and also when they ask to "document this feature", scaffold a Fumadocs/Next.js docs app, design
  a docs information architecture, or write MDX guides. Trigger even if the user doesn't say the word
  "docs" but clearly wants explanatory, reader-facing written material about how Carbon works.
---

# Carbon Docs

Build documentation for Carbon that people actually *want* to read: a site that feels designed,
prose that respects the reader's time, and an architecture organized around what the reader is
trying to accomplish — not around how the codebase happens to be laid out.

The north star is [cofounder.co/how-to/build](https://cofounder.co/how-to/build) (an editorial,
book-like **guide**) paired with [docs.cofounder.co](https://docs.cofounder.co) (a clean,
searchable **reference**). This skill teaches you to produce both surfaces, tailored to the Carbon
monorepo, using **Fumadocs** (Next.js + MDX).

## Two surfaces, one site

Great docs are not one undifferentiated wall of pages. They are two complementary modes, and almost
every confusing docs site fails because it blends them:

1. **The Guide** — editorial, narrative, opinionated. Walks a reader through a journey
   ("How to build a product," "Run your first job"). Long-form, sequenced, illustrated, with a
   strong voice that tells you *what matters, what people get wrong, and how Carbon handles it.*
   This is the surface that makes docs feel *beautiful and thoughtful*. It is the harder one to get
   right and the one most teams skip.

2. **The Reference** — structured, scannable, comprehensive. One page per concept/feature/endpoint.
   Cards, callouts, tables, parameter lists. Optimized for a reader who already knows what they want
   and needs to look it up fast.

A reader moves between them: a Guide page links into Reference pages for detail; a Reference page
links back to the Guide for the "why." Hold this distinction in your head the entire time — it
drives every IA, design, and writing decision below.

## How to use this skill

Work in phases. Each phase has a dedicated reference file — **read it when you reach that phase**,
don't preload everything. The references are the substance; this file is the map.

| Phase | Goal | Read |
|-------|------|------|
| 0. Orient | Decide what's being built and what already exists | this file |
| 1. Scaffold | Create the `apps/docs` Fumadocs app in the monorepo | `references/scaffold.md` |
| 2. Brand | Make it look unmistakably like Carbon | `references/brand-integration.md` |
| 3. Design | Apply the cofounder-grade visual language + signature touches | `references/design-language.md` |
| 4. Architect | Lay out the navigation and page taxonomy | `references/information-architecture.md` |
| 5. Components | Reach for the right MDX component for each idea | `references/components.md` |
| 6. Write | Author content in the Carbon editorial voice | `references/writing-guide.md` |
| 7. Verify | Prove it builds and looks right | this file (Verification) |

Bundled, ready-to-use code lives in `assets/templates/` — a turnkey `global.css`, Fumadocs config
files, and the bespoke React components that create the signature touches (reading-progress ruler,
scroll-reveal, chapter/step rail, feature callout, interactive checklist, media frame). Copy these in
rather than writing them from scratch; they already encode the Carbon brand and the cofounder
aesthetic. Adapt, don't reinvent.

## Phase 0 — Orient before you build

Two questions decide everything:

**Is this a new docs site, or content for an existing one?**
- Carbon has *no* in-repo docs site today (the live `docs.carbon.ms` is hosted elsewhere; the repo's
  `docs/` folder is just brainstorms). So "build the docs site" means scaffolding `apps/docs` →
  start at Phase 1.
- If `apps/docs` already exists when you read this, skip to Phase 4/6 and just add content. Always
  check first: `ls apps/docs` and look for `apps/docs/source.config.ts`.

**Guide, Reference, or both?**
- Most real requests are "both, eventually." Build the Reference skeleton first (it's the load-bearing
  structure), then layer Guide chapters on top. But if the user explicitly wants the *beautiful*
  onboarding narrative, lead with one polished Guide chapter — it sets the quality bar for everything
  after it.

Do not over-plan. Scaffold a thin vertical slice (one Guide page + one Reference page that build and
render), confirm it looks right, *then* scale out. A docs site that renders one gorgeous page beats a
fully-architected skeleton that renders nothing.

## Carbon non-negotiables

These are what make it *Carbon's* docs and not a generic Fumadocs template. Details in
`references/brand-integration.md`; the rules:

- **Location & tooling.** The app is `apps/docs`, registered by the existing `apps/*` workspace glob.
  Package manager is **pnpm** (catalog protocol — reuse `catalog:` versions, don't invent new ones).
  Lint/format is **Biome** (`biome.jsonc` at root) — no ESLint/Prettier. Turbo's generic `dev`/`build`
  tasks pick the app up automatically once it has those scripts; `.next/**` is already a build output.
- **React 18.** The monorepo's catalog pins `react@18.3.1`, and `@carbon/react` peer-depends on it.
  Use a Next.js version that runs on React 18 so you can reuse Carbon UI primitives. Don't drag the
  repo to React 19 for a docs app.
- **Brand by shared tokens, not hardcoded colors.** Import `@carbon/config/tailwind/theme.css` and the
  Geist fonts (`non.geist`), then *bake the default "Modern" theme's HSL values* into the docs app's
  CSS — Carbon's apps inject those at runtime via a React Router root route that a Next app doesn't
  have. The turnkey `assets/templates/global.css` already does this. Map Fumadocs' own CSS variables
  onto Carbon's tokens so the whole site shares one palette and one dark mode.
- **Reuse the design system.** Prefer `@carbon/react` primitives (Card, Alert, Tabs, CodeBlock,
  Accordion, Badge…) and existing patterns over new `bg-*`/`text-*` classes — same rule as the rest of
  the repo. Wrap client-only components with `"use client"` where Next requires it.
- **Geist + tight tracking.** Headings and body are Geist Variable; mono is Geist Mono; letter-spacing
  is `-0.02em`. This is already in the theme — just don't override it with a different font.

## The signature touches

This is the checklist that separates "a docs site" from the thing the user actually asked for —
*beautiful, comprehensive, super thoughtful*. Each is drawn from the cofounder pages and implemented
in `assets/templates/`. A finished Guide chapter should hit most of these; a Reference page hits the
calmer subset (search, TOC, cards, callouts, code).

- **Reading-progress ruler.** A thin tick-marked progress indicator down the right edge of Guide
  pages that fills as you scroll. Tells the reader "you're 40% through, this is finite." (`reading-progress.tsx`)
- **Scroll-reveal.** Sections fade/rise in as they enter the viewport — calm, not flashy. Makes long
  pages feel alive and paced. Respect `prefers-reduced-motion`. (`scroll-reveal.tsx`)
- **Chapter + step rail.** The Guide sidebar is a *journey*: roman-numeral chapters, each a vertical
  line of connected step-dots, the current step filled. Reads like a course, not a file tree. (`chapter-nav.tsx`)
- **Feature callouts.** A distinct two-column card ("Try in Carbon →") that bridges explanation to
  product action — main text on the left, a muted side-note on the right, a clear CTA. (`feature-callout.tsx`)
- **Interactive checklists.** For "do these N things" moments, render real checkboxes the reader can
  tick (state persists per page); checked items strike through. Turns reading into doing. (`checklist.tsx`)
- **Framed media.** Screenshots/diagrams sit in a rounded, subtly-bordered frame so they read as
  deliberate artifacts, never raw pasted images. Carbon's domain (machines, routings, work orders)
  rewards good diagrams. (`frame.tsx`)
- **Editorial measure & rhythm.** Guide prose is set at a comfortable reading measure (~68ch), with
  generous vertical spacing, real hanging punctuation where possible, and tabular numerals in tables.
- **Search & "On this page."** ⌘K search and a right-hand anchor TOC on Reference pages — table stakes,
  but they must be present and styled to match.

When you finish a page, walk this list and ask which touches it's missing. The gap between "fine" and
"thoughtful" is usually three of these.

## Verification

Never declare docs "done" without rendering them. A staff engineer reviewing this would expect:

1. **It builds.** From repo root: `pnpm --filter docs build` (or the app's exact name) completes with
   no type or MDX errors. `pnpm --filter docs dev` serves locally.
2. **It looks right — actually look.** Use the browser (Chrome MCP / the `login` + browser tooling
   already in this repo's skills) to load the dev server and screenshot a Guide page and a Reference
   page in *both* light and dark mode. Compare against the cofounder reference mentally: serif-grade
   typographic care, calm spacing, the signature touches present.
3. **Navigation works.** Sidebar groups expand, prev/next flow in reading order, search returns the new
   pages, every internal link resolves.
4. **Brand holds.** Geist everywhere, Carbon palette in both themes, no stray default-Fumadocs purple.
5. **Prose earns its place.** Re-read as a newcomer to Carbon. Does each page say what matters, name the
   common mistake, and point to the next step? If a paragraph doesn't do one of those, cut it.

Then, and only then, update `llm/tasks/todo.md` with a review section noting what was built and what's
deferred. After the work is committed, update `llm/cache/` to record that `apps/docs` exists and how
it's structured — never before it's committed.
