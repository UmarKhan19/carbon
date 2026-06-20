# Phase 3 — Design language

This is the "beautiful and thoughtful" phase. Everything here is reverse-engineered from
[cofounder.co/how-to/build](https://cofounder.co/how-to/build) (the Guide) and
[docs.cofounder.co](https://docs.cofounder.co) (the Reference), then expressed in Carbon's tokens.

Design principle that governs all of it: **calm, editorial, confident.** Lots of whitespace, a small
number of type sizes used consistently, color used sparingly for meaning (one accent), motion that
paces the reader rather than performing for them. Nothing should feel like a generic template; nothing
should feel busy.

## Two registers

| | **Guide** (editorial) | **Reference** (structured) |
|---|---|---|
| Feel | A book / a course | A well-organized manual |
| Layout | Chapter + step rail · wide reading column · reading-progress ruler | Grouped sidebar · content · "On this page" TOC |
| Type | Larger scale, generous leading, optional serif display headings | Compact, scannable, Geist throughout |
| Density | Low — one idea per screen | Medium — fast lookup |
| Motion | Scroll-reveal, progress | Minimal — instant, no surprises |
| Color | Mostly mono + one accent, framed illustrations | Mono + accent + semantic callout colors |

Build the Reference register on Fumadocs' defaults (re-themed in Phase 2). Build the Guide register with
the bespoke components in `assets/templates/components/`. They share the header, palette, fonts, and dark
mode, so moving between them feels like one site.

## Layout anatomy

**Shared header (both surfaces).** Carbon wordmark left; centered primary nav; ⌘K search; theme toggle;
a single dark CTA on the right (e.g. "Open Carbon →" to the app). Thin bottom hairline. The cofounder
nav uses subtle vertical divider bars between items and a soft pill on the active item — tasteful, worth
copying.

**Guide page.**
- *Left rail* — the journey. Roman-numeral chapters ("I. Getting started", "II. Building"), each a
  vertical line of connected step-dots; the current step is filled with the accent, completed steps are
  solid, upcoming steps are hollow. This is `chapter-nav.tsx`. It reads as progress, not as a file tree.
- *Center column* — a single comfortable reading measure (~68ch / `max-w-2xl`–`prose`). A small "Chapter
  II" eyebrow/badge above the H1. Display H1. Long-form prose with framed media, feature callouts, and
  interactive checklists interspersed.
- *Right edge* — the reading-progress ruler (`reading-progress.tsx`): a column of fine tick marks with an
  accent segment that tracks scroll depth. Quiet, fixed, ~1px ticks.

**Reference page.**
- *Left sidebar* — grouped nav with section labels (Get Started, Workspace, Agents, Integrations…), each
  group a list of links; the active page gets a soft pill + accent text. Optional small leading icons on
  top-level items.
- *Center column* — H1, one-line lead/description, then `##` sections each with a hairline rule beneath
  the heading, cards, callouts, tables, code.
- *Right "On this page"* — anchor links to the `##`/`###` headings, current section highlighted.
- *Footer* — prev/next page cards in reading order.

## Typography

Geist everywhere (Phase 2). The editorial feel is built from **scale and rhythm**, not a different font.

- **Type scale** (use few, consistently):
  - Display H1 (Guide): ~44px desktop / 36px mobile, tight tracking, weight 600.
  - H1 (Reference): ~30px. H2: ~22–24px. H3: ~18px. Body: 16px (Reference) / 17–18px (Guide, for
    comfortable long reading). Small/meta: 13–14px.
- **Measure.** Guide body wraps at ~66–72 characters. Never let prose run the full content width — long
  lines kill readability. Reference body can be a touch wider since it's scanned, not read.
- **Leading.** Guide body ~1.7; headings ~1.15. Give headings real space above (`mt-12`+) so sections
  breathe.
- **Tracking.** `-0.02em` is already the default (`--tracking-normal`). Display headings can go slightly
  tighter (`-0.03em`); don't loosen body.
- **Numerals.** Use tabular numerals (`tabular-nums`) in tables, spec lists, and anything with aligned
  figures — Carbon's domain is full of quantities, lot sizes, lead times, costs.
- **Optional serif display.** To get the cofounder "book" warmth, a serif *for display headings only* is
  legitimate (the cofounder wordmark and H1s read as serif). If you do this, load one serif face, use it
  solely for H1/eyebrow display, keep everything else Geist, and confirm it still reads as Carbon. This is
  a taste call — default to Geist display unless the user wants the editorial serif.

## Color & surface

- **Restraint.** The page is mostly background + foreground + muted. Carbon's default is near-black ink on
  white (light) and a Vercel-style pure-black base (dark). Let that calm do the work.
- **One accent.** Pick a single accent for interactive/active states and the reading-progress fill. The
  cofounder Guide uses a clear blue. Carbon's default primary is near-black, which is too quiet for an
  accent — choose a Carbon theme accent (e.g. the "Blueberry" blue from `themes.ts`) for *highlight*
  moments while keeping primary near-black for text/buttons. Use it sparingly: active step-dot, progress
  ruler, links on hover, the feature-callout label.
- **Surfaces.** Cards and callouts sit on `--card`/`--muted` with a `--border` hairline and `--radius`
  corners. Subtle shadow at most (`shadow-sm`). No heavy drop shadows, no gradients except the existing
  `bg-gradient-fade` utility where a fade genuinely helps.
- **Semantic callouts.** Note/Tip = neutral/accent; Warning = `--destructive`; Success = `--success`.
  Keep them low-saturation in light mode and legible in dark.

## Motion

Motion exists to *pace and orient*, never to entertain. `framer-motion` is already in the catalog.

- **Scroll-reveal** (`scroll-reveal.tsx`): sections fade in + rise ~8–12px as they enter the viewport,
  once, with a gentle ease (~0.4s). Subtle enough that a reader feels it more than sees it.
- **Reading progress**: smooth, not jumpy; spring or eased.
- **Hover**: links and cards get a quick (~150ms) color/translate nudge. Buttons feel pressable.
- **Always** wrap motion in `prefers-reduced-motion` — if the user opts out, render the final state with
  no animation. This is non-negotiable for accessibility and is built into the templates.

## The signature touches (implementation)

Each maps to a file in `assets/templates/components/`. Read `references/components.md` for usage and
props; the design intent is here.

1. **Reading-progress ruler** — finite-ness made visible. A reader who can see the end keeps going.
2. **Scroll-reveal** — turns a long page into a paced experience instead of an intimidating wall.
3. **Chapter + step rail** — frames docs as a journey with a beginning and end; the filled dot answers
   "where am I?" at a glance.
4. **Feature callout** — the bridge from "understand" to "do it in Carbon." Two columns: the explanation
   and a muted aside, with a clear CTA. Use it whenever a concept has a direct product action.
5. **Interactive checklist** — for procedural moments ("before you create a work order, confirm…"). Real,
   tickable, state-persisting checkboxes convert passive reading into completed steps.
6. **Framed media** — every screenshot/diagram in a rounded, hairline-bordered frame so it reads as a
   deliberate figure. Caption below in muted small text.
7. **Editorial rhythm** — the measure, leading, and spacing rules above, applied consistently.
8. **⌘K search + On-this-page** — Fumadocs provides both; theme them and make sure new pages are indexed.

## Quality bar — do / don't

**Do**
- Lead each Guide chapter with a strong, opinionated paragraph and (often) a framed hero illustration.
- Use one idea per screen in the Guide; let whitespace separate thoughts.
- Keep the same eight type sizes across the whole site.
- Test every page in light *and* dark before calling it done.

**Don't**
- Don't fill space with stock imagery or decorative gradients.
- Don't introduce a second accent color or a third font weight family "for variety."
- Don't animate on a timer or loop anything — motion is scroll/interaction-driven only.
- Don't let the Guide and Reference drift into two different-looking sites; the shared header, palette,
  and fonts are the throughline.

When a page is finished, screenshot it and hold it next to the cofounder reference. If yours looks busier,
remove something. If it looks flatter, it's usually missing one of the signature touches or the type
scale is too small.
