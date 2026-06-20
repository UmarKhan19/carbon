# Phase 4 — Information architecture

How you organize the docs decides whether people find what they need. The single most important rule:

> **Organize around what the reader is trying to do, not around how the product is built.**

cofounder.co nails this. Its top-level nav is a *lifecycle* — **Start → Build → Sell → Scale** — not a
list of internal modules. A founder reads it as "where am I in my journey," and each stage is a Guide
chapter. The Reference (docs.cofounder.co) then mirrors the product's structure (Workspace, Agents,
Integrations…) for lookup. Carbon should do the same: a journey-shaped **Guide**, a structure-shaped
**Reference**.

## Carbon's journey (the Guide's top-level chapters)

Carbon is a manufacturing platform (ERP + MES + the academy training app). A natural reader journey:

- **I. Get set up** — what Carbon is, how the ERP/MES/portal fit together, first login, your company &
  units, inviting your team.
- **II. Model your shop** — items/parts, bills of materials, routings, work centers/resources,
  suppliers & customers. (The nouns of manufacturing.)
- **III. Run production** — quotes → sales orders → jobs/work orders, scheduling, issuing material, the
  MES shop-floor flow, labor & operations, completing and shipping.
- **IV. Buy & stock** — purchasing, receiving, inventory, counts, traceability.
- **V. Close the loop** — quality, costing, reporting, integrations, and extending Carbon.

Confirm the real module names and flows before committing this — derive them from the actual ERP/MES
route structure and the cache (per AGENTS.md, query `llm/cache/` first; modules surface via
`requirePermissions(request, { view: "<module>" })` and the `apps/erp` / `apps/mes` routes). The shape
above is the *pattern*; the exact chapter list should match how Carbon actually works. The
`apps/academy` `config.tsx` curriculum (Modules → Courses → Topics → Lessons) is a strong signal for the
journey ordering — the docs Guide and the academy courses should tell a consistent story.

Each chapter is a sequence of Guide pages (steps in the rail). Keep chapters to ~4–9 steps; if a chapter
sprawls, it's two chapters.

## The Reference's structure (lookup-shaped)

Mirror the product so a reader who knows the noun finds it fast. Group by area, one page per
concept/feature:

```
Reference
├── Overview                     (what's here, how to read it)
├── Core concepts                (item, BOM, routing, work center, job, order… the vocabulary)
├── ERP
│   ├── Items & BOMs
│   ├── Sales & quoting
│   ├── Purchasing & receiving
│   ├── Inventory
│   └── …one page per module…
├── MES
│   ├── Shop-floor app
│   ├── Operations & labor
│   └── …
├── Integrations                 (Stripe, MCP, custom, …)
├── Administration               (company, users & permissions, domains, env/secrets)
└── API & extensibility
```

Again: align the module list to the real ERP/MES navigation rather than inventing it. The point is the
*one-noun-per-page* discipline and the area grouping.

## Page taxonomy — five page types

Most docs confusion comes from mixing these on one page. Decide a page's type up front:

| Type | Surface | Answers | Shape |
|------|---------|---------|-------|
| **Tutorial** | Guide | "Walk me through my first ___" | Numbered, narrative, one happy path, ends in a win |
| **How-to** | Guide or Reference | "How do I do ___?" | Task steps, prerequisites, minimal theory |
| **Concept** | Reference (or Guide intro) | "What is ___ and why?" | Explanation, diagrams, links to how-tos |
| **Reference** | Reference | "What are the exact fields/options?" | Tables, parameter lists, exhaustive, scannable |
| **Overview** | Both | "What's in this section?" | Short intro + card grid to children |

Guide chapters are mostly Tutorial + Concept woven together with strong narration. Reference pages are
Concept + Reference + How-to. Don't put exhaustive field tables in the middle of a narrative chapter —
link out to the Reference page instead. Don't put motivational narration in a field-reference table —
link back to the Guide.

## Fumadocs `meta.json`

Fumadocs derives the sidebar from the `content/docs` tree plus `meta.json` files that set order, titles,
icons, and grouping. One `meta.json` per folder:

```jsonc
// content/docs/meta.json  (top level)
{
  "title": "Carbon Docs",
  "pages": ["index", "concepts", "---Guide---", "guide", "---Reference---", "erp", "mes", "integrations", "administration"]
}
```

```jsonc
// content/docs/guides/meta.json
{
  "title": "Guide",
  "icon": "BookOpen",
  "pages": ["index", "get-set-up", "model-your-shop", "run-production", "buy-and-stock", "close-the-loop"]
}
```

Conventions:
- `"---Label---"` entries render as **group separators/headers** in the sidebar — use them to split Guide
  from Reference and to label Reference areas.
- `"pages"` is an explicit order; anything omitted is appended alphabetically (prefer explicit ordering so
  reading order is deliberate).
- `"icon"` references a Lucide icon name (Fumadocs resolves it) — give each top-level group a quiet icon.
- Use `"defaultOpen": true` on the section a first-time reader should land in.
- For the editorial **chapter + step rail**, the Guide's `meta.json` order *is* the step order — the
  `chapter-nav.tsx` component reads page order to draw the connected dots, so the file order, the sidebar,
  and the rail stay in sync from one source of truth.

## Slugs, titles, and frontmatter

Each MDX page starts with frontmatter Fumadocs understands:

```mdx
---
title: Create your first work order
description: Turn a sales order into a job the shop floor can run.
---
```

- **Slugs**: short, kebab-case, stable. `run-production/first-work-order`, not
  `chapter-3-creating-a-work-order-tutorial`. URLs are a contract — don't churn them.
- **Title**: imperative for how-tos/tutorials ("Create a work order"), noun for concept/reference
  ("Work orders"). Match the page type.
- **Description**: one sentence; it feeds search results, social cards, and the overview card grid, so
  make it say what the reader gets.

## Cross-linking is the architecture

The IA only works if the two surfaces are stitched together:
- Every Guide step that mentions a noun links to that noun's Reference page ("…create a **[routing](/erp/routings)**…").
- Every Reference page links back to the Guide chapter that puts it in context ("New here? See
  **[Model your shop](/guides/model-your-shop)**").
- Overview pages use card grids (`references/components.md`) to fan out to children.
- Prev/next at the foot of Guide pages follows the step order so a reader can just keep pressing "next"
  through a chapter.

A reader should never hit a dead end — every page offers an obvious next move.
