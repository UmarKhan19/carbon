# Phase 5 — Component catalog

The vocabulary you write docs *with*. Two sets: Fumadocs built-ins (use for the Reference surface and
standard needs) and the Carbon bespoke components (use for the editorial Guide surface). Register both in
`mdx-components.tsx` so authors can use them in any `.mdx` page without per-file imports.

## Registering components globally

```tsx
// mdx-components.tsx
import defaultComponents from "fumadocs-ui/mdx";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Callout } from "fumadocs-ui/components/callout";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { TypeTable } from "fumadocs-ui/components/type-table";
// Carbon bespoke (assets/templates/components/*)
import { ReadingProgress } from "@/components/reading-progress";
import { ScrollReveal } from "@/components/scroll-reveal";
import { ChapterNav } from "@/components/chapter-nav";
import { FeatureCallout } from "@/components/feature-callout";
import { Checklist, Check } from "@/components/checklist";
import { Frame } from "@/components/frame";
import { Eyebrow } from "@/components/prose";

export function getMDXComponents(components) {
  return {
    ...defaultComponents,
    Card, Cards, Callout, Tab, Tabs, Step, Steps, Accordion, Accordions, TypeTable,
    ScrollReveal, FeatureCallout, Checklist, Check, Frame, Eyebrow,
    ...components,
  };
}
```

(`ReadingProgress` and `ChapterNav` are layout pieces — mount them in the Guide layout, not inside MDX.)

## Fumadocs built-ins — use for Reference + standard needs

**Cards / Card** — overview fan-out and link grids. The backbone of every Overview page.
```mdx
<Cards>
  <Card title="Items & BOMs" href="/erp/items" icon={<Package />}>
    Parts, assemblies, and the bills of materials that connect them.
  </Card>
  <Card title="Routings" href="/erp/routings" icon={<GitBranch />}>
    The operations and work centers a part flows through.
  </Card>
</Cards>
```

**Callout** — break the reader's flow for something that matters. Don't overuse — three callouts on a page
means none of them land.
```mdx
<Callout type="warn">Issuing material is irreversible once the job is started.</Callout>
<Callout type="info">Work orders inherit the routing from the item's default revision.</Callout>
```
Types: `info` / `note` (neutral), `tip` (accent), `warn` (destructive), `error`. Map to Carbon semantic
tokens in Phase 2.

**Steps / Step** — ordered procedures in the Reference (the Guide uses the chapter rail for top-level
sequence, but `Steps` is great for a sub-procedure within a page).
```mdx
<Steps>
  <Step>Open the sales order and click **Convert to Job**.</Step>
  <Step>Confirm the routing and quantity.</Step>
  <Step>Release the job to the shop floor.</Step>
</Steps>
```

**Tabs / Tab** — alternative paths (e.g. "ERP UI" vs "API", or OS-specific). Keep tab labels parallel.

**Accordions / Accordion** — FAQs and progressive detail a reader can skip. Not a place to hide essential
steps.

**TypeTable** — the right tool for reference field/parameter documentation; renders a typed table with
name, type, default, description. Use it for API payloads, config options, and entity field references
instead of hand-built tables.

**CodeBlock** — fenced code with language, optional `title`, and line highlighting. Carbon already
standardizes on Shiki with the `github-dark-default` theme (see `@carbon/react`'s `CodeBlock`); match it so code in
the docs looks like code in the app. Use ```ts title="example.ts" {2-3}``` syntax.

**ImageZoom / Files** — zoomable images and file-tree diagrams when useful. Prefer `Frame` (below) for
primary screenshots so they get the editorial treatment.

## Carbon bespoke — use for the Guide

These create the signature touches. Code lives in `assets/templates/components/`; design intent is in
`references/design-language.md`. Copy them into `apps/docs/components/`.

**`<ReadingProgress />`** — the right-edge tick ruler. Mount once in the Guide layout; it reads scroll
position and fills with the accent. No props for the common case.

**`<ChapterNav />`** — the roman-numeral chapter + connected step-dot rail. Mount in the Guide layout; it
derives chapters/steps from the Fumadocs page tree (the `meta.json` order) so it stays in sync with the
sidebar. The current page's dot is filled.

**`<ScrollReveal>`** — wrap a section to have it fade/rise in on scroll. Honors `prefers-reduced-motion`.
```mdx
<ScrollReveal>
## Why routings matter
A routing is the recipe the shop floor follows…
</ScrollReveal>
```

**`<FeatureCallout>`** — the two-column "bridge to product" card: explanation + muted aside + CTA. Use it
whenever a concept has a direct action in Carbon.
```mdx
<FeatureCallout title="Try in Carbon" href="https://app.carbon.ms" cta="Open Carbon →"
  aside="Routings can be templated per item revision, so you set them once.">
Use the routing builder to lay out operations and assign each to a work center. Carbon estimates run
time from the work center's rates so your job schedule is realistic from day one.
</FeatureCallout>
```

**`<Checklist>` / `<Check>`** — stateful, tickable checklist (persists per page in `localStorage`,
checked items strike through). For "before you do X, confirm…" moments.
```mdx
<Checklist>
  <Check>Item has an active revision</Check>
  <Check>Routing has at least one operation</Check>
  <Check>Required materials are in the BOM</Check>
</Checklist>
```

**`<Frame>`** — wraps a screenshot/diagram in a rounded, hairline-bordered frame with an optional caption.
```mdx
<Frame caption="The routing builder, mid-edit.">
  ![Routing builder](/screens/routing-builder.png)
</Frame>
```

## Choosing a component (quick guide)

- Linking to several child pages → **Cards**.
- A short ordered procedure inside a page → **Steps**.
- A thing the reader must not miss → **Callout** (one, maybe two, per page).
- Documenting fields/params/options → **TypeTable**.
- Showing the same task two ways → **Tabs**.
- A concept that maps to a product action → **FeatureCallout**.
- A "confirm these before proceeding" list → **Checklist**.
- Any primary screenshot or diagram → **Frame**.
- A long Guide section that should breathe → wrap in **ScrollReveal**.

When a built-in and a bespoke component overlap, pick by surface: Reference → Fumadocs built-in; Guide →
bespoke. Don't stack both on one page — coherence beats variety.

## Diagrams

Carbon's domain (material flow, routings, order→job→ship) is diagram-friendly. Fumadocs supports Mermaid
via a code block; render flow/sequence diagrams inline and wrap them in `<Frame>` for consistent framing.
Keep diagrams in the foreground color on transparent background so they work in both themes.
