# Guide / Written User Manual (`/guide`)

A public, multi-page, self-serve **written manual** that teaches end users how to
use Carbon end-to-end. It is the written counterpart to Carbon Academy
(learn.carbon.ms) and deliberately mirrors the look and feel of the public
`/mcp` docs page.

## Routing

- Lives under `apps/erp/app/routes/guide+/` (remix-flat-routes).
- **Public** — no `requireAuthSession` / `requirePermissions`, like `mcp+`.
- `_layout.tsx` owns the shared chrome (nav, sidebar, footer) and declares the
  stylesheet via `links` (inherited by all chapter routes). Renders the `.GUIDE`
  wrapper + a `container` grid: `GuideSidebar` + `<Outlet/>`.
- `_index.tsx` → `/guide` overview/landing page.
- One thin route file per chapter (e.g. `items.tsx` → `/guide/items`); each just
  looks its chapter up via `getChapter(slug)` and renders `<GuideChapter/>`.
- Note: colocated non-route files at the `guide+` root (e.g. `guide-content.ts`)
  register as harmless phantom routes — same behavior as `mcp+`'s `catalog.ts` /
  `tools-filter.ts`. Build and typecheck pass regardless.

## Content model

- `guide+/guide-content.ts` is the **single source of truth**: a typed
  `CHAPTERS: Chapter[]` registry. `Chapter → GuideSection[] → GuideBlock[]`.
- Block kinds: `prose`, `callout` (note/tip/warning), `steps`, `spec`,
  `screenshot`. Prose/callout/steps support tiny inline markdown
  (`**bold**`, `*italic*`, `` `code` ``) via `components/inline.tsx`.
- Chapters (ordered): core-concepts, getting-started, items,
  customers-and-suppliers, sales, purchasing, inventory, production, mes,
  quality, mrp, accounting, settings, workflows, glossary.

## Components

- Shared, content-free primitives live in `apps/erp/app/components/Docs/`
  (`Section`, `Screenshot`, `SpecRow`, `ThemeToggle`, `WaveScrollRail`,
  `useInViewClass`, `useScrollSpy`) — copied from `mcp+` so `/guide` reuses the
  look without coupling to `/mcp`. (A future follow-up could dedupe `/mcp` onto
  these.)
- Guide-specific chrome in `guide+/components/`: `GuideNav`, `GuideSidebar`
  (chapter list + scroll-spied on-this-page TOC), `GuideChapter` (renders a
  chapter from data), `GuideFooter`, `blocks.tsx` (block renderers), `inline.tsx`.

## Styling

- `apps/erp/app/styles/guide-docs.css` — a `.GUIDE`-scoped copy of
  `mcp-docs.css` tokens + animation utilities (reveal / stagger / hr-wipe /
  toc-track / waverail) with `.dark .GUIDE` overrides.

## Screenshots

- `screenshot` blocks ship with `src: ""` and render a labelled placeholder
  (`ScreenshotSlot` in `blocks.tsx`). Real captures go in
  `apps/erp/public/guide/<chapter-slug>/<section-id>-<n>.png`; set the block's
  `src` to wire them up. See `apps/erp/public/guide/README.md`.
- The capture pass needs a running seeded app (local dev or the Helio/ACME demo
  tenants); it was not done in the initial build.
