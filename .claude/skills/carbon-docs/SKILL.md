---
name: carbon-docs
description: >-
  Author, edit, or extend the Carbon documentation site at `apps/docs` (a built Fumadocs + Next.js
  app). Use whenever creating or changing reader-facing docs for Carbon: editorial Guide chapters,
  Reference/entity pages, the docs IA, or "document this feature" requests — anything destined for
  the docs site. Covers the grounded-in-source authoring workflow, the flow-based Guide architecture,
  the real MDX components for each surface, the warm-paper house style, and the build verification
  loop. Trigger even if the user doesn't say "docs" but clearly wants explanatory, reader-facing
  written material about how Carbon works.
---

# Carbon Docs

`apps/docs` is a **built, opinionated** documentation site — Fumadocs + Next.js (React 19), **light-only**,
warm-paper aesthetic. It is no longer scaffolded; it exists and ships content. This skill is how to add
or change docs **in that system, in its house style, grounded in real Carbon code.**

> The single biggest mistake is writing plausible ERP-generic prose. Carbon's behavior is specific and
> often counterintuitive (WIP is a GL balance not a table; payment is a field not an entity; overhead is
> not absorbed; fixed-asset disposal is scrapping-only). **Every claim is grounded in source.** See the
> prime directive below — it overrides everything.

## The prime directive — ground everything in source

The **holy source of truth is the actual source code + the LATEST database migrations**
(`packages/database/supabase/migrations/`, newest by timestamp) — NOT ERP/CMMS general knowledge, NOT
`llm/cache/` alone (it is often stale).

- **Verify before you write.** Every entity, status enum *value*, and transition named in docs must exist
  in real code. Confirm exact strings (`"To Ship and Invoice"`, `"Fully Depreciated"`), the actions that
  drive them (service fns, routes, edge functions in `packages/database/supabase/functions/`), and what
  posts/gates (e.g. `companySettings.accountingEnabled`).
- **Read the newest migration, not the first.** Timestamps order them; a 2026 refactor may have rebuilt a
  subsystem the cache still describes the old way.
- **Document only real, ACTIVE features.** Omit placeholders / inactive / not-yet-shipped things (e.g.
  integration registry entries with `active: false` like QuickBooks/Sage/Zapier). Don't surface them.
- **When code and cache disagree, code wins** — and note the drift.
- **Method:** dispatch a research subagent per feature → return verified facts with `file:line` refs →
  then write. This is how every flow in the Guide was built. Don't skip it for anything non-trivial.

## Three surfaces (know which you're touching)

| Surface | Path / route | What it is | Authored? |
|---|---|---|---|
| **Guides** | `content/guides/*.mdx` → `/guides` | Editorial narrative *tours*, grouped into **flows**. Second-person, opinionated, illustrated. The journey + the "why". | Hand-written MDX |
| **Reference** | `content/docs/**/*.mdx` → `/docs` | One page per entity/concept. Scannable: tables, cards, field rows. The "what". | Hand-written MDX |
| **API reference** | `app/api-reference/[module]/[resource]` | PostgREST endpoint docs, **generated at build** from the swagger. | **Generated — do NOT hand-edit.** Edit `scripts/generate-api-docs.mjs` or the swagger schema. |

Interlink across surfaces and flows: a Guide links into Reference for detail; Reference links back to the
Guide for the story. (Guide chapters were given 12 cross-flow links — interlinking is expected, not optional.)

## Authoring workflow (every change)

1. **Research (grounded).** Subagent verifies the feature vs source + newest migrations. Get exact
   table/column/enum/transition names + `file:line`. Flag what a generic description would get wrong.
2. **Pick the surface + placement.** Guide flow + frontmatter, or Reference folder + `meta.json` order.
3. **Write in the house voice** with the surface's real components (below). Lead with a concrete example.
4. **Verify (always).** Regenerate, typecheck, build, and grep the prerendered HTML:
   ```bash
   cd apps/docs
   pnpm exec fumadocs-mdx                 # regen .source — REQUIRED after frontmatter/schema changes
   npx tsc --noEmit                       # or: pnpm --filter docs typecheck
   pnpm --filter docs build               # expect "✓ Generating static pages (N/N)"
   grep -o "your new heading" .next/server/app/guides/<slug>.html   # confirm it rendered
   ```

## Guides — the flow architecture

Frontmatter (`source.config.ts` schema):

```yaml
---
title: From quote to order
description: An RFQ becomes a quote; an accepted quote becomes a sales order.
label: "(I)"          # display marker, roman numeral, per-flow
index: 0              # order WITHIN the flow (0,1,2…)
flow: quote-to-cash   # flow id (omit → defaults to "make-to-order")
flowName: Quote to cash   # flow tab label
flowIndex: 1          # order of the flow in the subnav (0 = first)
---
```

- Chapters sort by `(flowIndex, index)`. The **subnav is a flow switcher**; the **sidebar + mobile selector
  + "read next" are scoped to the active flow**. The original 5 chapters (order/build/plan/floor/ship) carry
  no flow fields and fold into `make-to-order` (flowIndex 0) via defaults.
- **Add a chapter to a flow:** same `flow`/`flowName`/`flowIndex`, next `index` + `label`.
- **Add a flow:** new `flowIndex` + `flowName`; its chapters start at `index: 0`, `label: "(I)"`.
- All chapter bodies render server-side on every page (the reader cross-fades, no route nav), so links to
  `/guides/<slug>` resolve. **No code fences in guides** (prose + components only).

**Components** (`components/editorial/mdx.tsx`):

- `<Figure illustration="flow-overview" caption="…" />` — SVG from the registry. **`illustration` MUST be a
  real key** from `components/editorial/illustrations.tsx` (else it silently renders nothing). Valid keys:
  `flow-overview, order-split, bom-tree, demand-forecast, planning-engine, shopfloor-loop, eight-d,
  traceability-graph, method-types, kit-vs-subassembly, reorder-policy, outside-processing, mes-station,
  issue-workflow, schedule-board, get-method, conversion-factor`. For anything without a fitting key, use
  `<Screenshot>` instead — don't invent keys.
- `<Screenshot label="Sales order dashboard" caption="…" ratio="wide|tall|square" />` — placeholder frame,
  free-text label (no image asset needed). Default `ratio="wide"`.
- `<Callout tone="neutral|blue|green|amber" badge="WHY BATCH" title="…">body</Callout>` — the workhorse.
  Use it to carry the **Carbon-specific truth a generic description gets wrong**. Tones: blue = explanatory
  "why", green = good-to-know/outcome, amber = caution/contrast, neutral = definitional.
- `<Divider />` — closes a chapter before its wrap-up line.

Each `##` heading becomes a sidebar rail entry — so structure chapters as 3–5 `##` sections.

## Reference — entity pages

- Frontmatter: `title` + `description` only.
- **Nav = `meta.json` `pages` arrays** (ordered). Folders: `content/docs/{reference,platform,integrate}/`.
  Root order in `content/docs/meta.json`; a folder's order + sidebar title in its own `meta.json`
  (`{ "title": "Product reference", "defaultOpen": true, "pages": [...] }`). Add a page → add its slug to
  the folder's `pages`.
- **Components** (`components/editorial/reference-components.tsx` + `components/mdx.tsx`):
  - `<Callout type="info|note|warn|warning|error|success|tip" title?>…</Callout>` — type → badge+tone
    (`info/note`→NOTE/blue, `warn/warning/error`→HEADS UP/amber, `success/tip`→GOOD TO KNOW/green). Note this
    is a **different Callout API** than the Guides one (type vs tone+badge).
  - `<Cards><Card title href icon?>…</Card></Cards>` — link-card grid (cross-surface navigation).
  - `<EnvVars><EnvVar name type? default? required?>…</EnvVar></EnvVars>` — field/parameter rows.
  - `<Steps>/<Step>`, `<Tabs>/<Tab>` (fumadocs-ui), markdown tables, and code fences (dark panel).
- Voice is more technical/scannable than the Guides — fields, constraints, tables — but still names the
  gotcha and links back to the Guide for the narrative.

## House voice

- **Second person, concrete, narrative.** Anchor in the running example (the 90-unit humanoid-robot order).
  "Open the sales order dashboard." / "You don't build 90 robots as one monolithic job."
- **Quote real status names exactly**, in quotes: `**"To Ship and Invoice"**`, `**"Posted"**`, `**"Open"**`.
- **Callouts carry the counterintuitive truth** — the thing people get wrong. Title is a claim, body is the
  why. ("Quotes are optional — the opportunity is the thread.")
- **Explain the why, name the mistake, point to the next step.** If a paragraph does none of those, cut it.
- **Interlink** at natural seams (`[make-to-order tour](/guides/order)`).

## Design / styling

- **Light-only.** Warm-paper palette: page bg `#FBFBF9` / `#F5F5F2`; ink `#262323` (+ `rgba(38,35,35,0.x)`
  for faint); accent `#1E84B0` (links) / `#00B0FF` (focus/brand); hairlines `#E7E7E3` / `#E3E3DF`.
- **Inline Tailwind arbitrary values** (`text-[15px]`, `bg-[#FBFBF9]`, `border-[#E7E7E3]`) — this app is
  standalone (NOT `@carbon/react`, NOT the ERP theme). Match the surrounding component's density and colors;
  don't introduce a new palette.
- Fonts: DM Sans (body), Fira Code (mono). Callout tone fills/borders: neutral `#EFEFEB/#DADAD5`,
  blue `#DFF5FF/#A9DAF3`, green `#E4F8DA/#A8DB91`, amber `#FFF2D8/#E6CFA3`.

## Gotchas (hard-won)

- **Shiki theme** (`source.config.ts` → `rehypeCodeOptions.themes`): set **both** `light` and `dark` to the
  same `"github-dark-default"`. A single `theme` (or a missing `github-light`) breaks the build for any
  `content/docs` file with a code fence (`ShikiError: Theme github-light not found`). Guides have no fences,
  so they're immune — handy for isolating a red build to the Reference side.
- **Regen `.source` before typecheck** after any frontmatter/schema change (the schema is baked into
  `.source/` at generate time).
- **Figure keys must exist** — see the list above; a typo renders nothing, silently.
- **`Write` blocks on existing files** — natural collision protection when a parallel session co-writes the
  docs. Just write the next uncovered gap; don't pause to coordinate unless asked.
- **`curl` GET can 405 in this sandbox** (a method-less request reads as POST) — use the WebFetch tool for
  external pages; the pnpm registry works fine.
- **Don't hand-edit the API reference** (generated) — change the generator/schema and rebuild.

## Deep-dive references (read when you reach the relevant phase)

- `references/components.md` — full component APIs for both surfaces + the illustration registry.
- `references/writing-guide.md` — the voice, the grounding rule, worked examples.
- `references/information-architecture.md` — the flow IA and the Reference `meta.json` nav.
- `references/design-language.md` — palette, fonts, the inline-Tailwind convention.

> Note: `references/scaffold.md`, `references/brand-integration.md`, and `assets/templates/*` are
> **scaffolding-era** (how the app was first stood up, with Geist/`@carbon/react`/signature-touch templates).
> The app diverged from them. **The live components in `apps/docs/components/{editorial,api}/` are the source
> of truth** — read those, not the templates, when in doubt.

## Verification bar

Never declare docs done without: a green `pnpm --filter docs build`, `tsc` clean, the new content present in
the prerendered HTML, every internal link resolving, names matching real code, and a re-read that confirms
each page says what matters / names the mistake / points onward. Then record progress (this loop tracks it in
`llm/tasks/` and the `project_docs_guide_flows` memory; the live API-reference/search work tracks its own).
