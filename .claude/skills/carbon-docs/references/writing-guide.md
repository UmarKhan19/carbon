# Phase 6 — Writing guide

A beautiful site with mediocre prose is still mediocre docs. This is how to write the words so they're
worth the design. The voice is modeled on cofounder.co's guides — and it's a *voice*, a deliberate one,
not the flat neutral tone most docs default to.

## The voice in three moves

Read how cofounder writes a section. Almost every one makes the same three moves:

1. **Say what actually matters** — lead with the real point, not preamble.
2. **Name the mistake** — call out what people get wrong, specifically.
3. **Show how the product handles it** — bridge to the action.

> *"Setting up an engineering department is more than just writing code… Most first-time founders
> dramatically underestimate this; they think 'building' means opening a code editor and hacking until
> something works. That approach gets you a prototype. It does not get you a company."*

That's all three moves in three sentences: what matters, the mistake, the consequence. Notice it's
**opinionated** ("It does not get you a company"), **concrete**, and **second person**. Do this.

The other hallmark is **ruthless specificity**:

> *"Be ruthlessly specific. 'Helping people manage their finances' is not a problem statement.
> 'Freelancers lose track of quarterly tax estimates because existing tools assume W-2 employment' is."*

Always prefer the concrete example over the abstract description. In Carbon's domain that means real
nouns and numbers: *"A routing with no operations can't be scheduled — the job sits in Planned forever,"*
not *"Ensure your routing is configured correctly."*

## Voice principles

- **Second person, active, present tense.** "You create a job from the sales order." Not "A job is
  created" or "One would create."
- **Lead with the point.** First sentence of every section states the takeaway. A reader who stops there
  should still have learned the main thing.
- **Be opinionated where it helps.** Tell the reader the right default and why. "Start with one work
  center per machine, not per operator — you'll thank yourself when you schedule." Docs that refuse to
  recommend anything make the reader do all the work.
- **Name the common mistake.** You know what trips people up. Say it out loud. This is the single highest-
  value sentence on most pages.
- **Short paragraphs.** 2–4 sentences. One idea each. White space is part of the writing.
- **Concrete over abstract, always.** Real item numbers, real quantities, a real shop scenario. The
  manufacturing domain is full of specifics — use them.
- **Respect the reader's time.** If a sentence doesn't teach, warn, or move them forward, cut it. No "In
  this section, we will explore…" throat-clearing. No restating the heading.
- **Plain words.** Prefer "make" to "utilize," "use" to "leverage." Technical terms are exact (a *work
  order* is not a *job* is not an *operation* — pick the right one and stay consistent).

## Terminology: one word per concept

Carbon's `apps/academy` already teaches this vocabulary (Modules → Courses → Topics → Lessons in
`config.tsx`). The docs must use the *same words* for the same things as the app UI and the academy
courses. Before writing a chapter, list the domain nouns it touches and pin the exact term (item vs part,
job vs work order, routing vs process). Inconsistent terminology is the fastest way to lose a reader's
trust. When in doubt, match the label in the ERP/MES UI.

## Page templates

### Guide chapter intro (the editorial opener)
```mdx
---
title: Run production
description: From a confirmed order to a finished part on the dock.
---

<Eyebrow>Chapter III</Eyebrow>

# Run production

Everything so far has been setup. This is where Carbon earns its keep: turning a confirmed order into
work the floor can actually do, tracking it as it happens, and shipping it.

This chapter walks the whole path — order → job → schedule → execute → ship — and at each step flags the
decisions that quietly determine whether your due dates mean anything.

<Frame caption="A job moving across the shop-floor board.">
  ![Shop floor board](/screens/mes-board.png)
</Frame>
```
Then each step is its own page, narrated, ending by pointing at the next step.

### Tutorial (first-time, one happy path)
```mdx
# Create your first work order

By the end of this you'll have a job on the shop floor, scheduled, with material reserved. ~10 minutes.

## Before you start
<Checklist>
  <Check>An item with an active revision</Check>
  <Check>A routing with at least one operation</Check>
</Checklist>

## 1. Start from the sales order
…one path, no branching, every click named…

## You're done
You just turned an order into runnable work. Next: **[schedule the job](/guides/run-production/scheduling)**.
```

### How-to (task, assumes context)
```mdx
# Reserve material for a job

**Goal:** guarantee the parts a job needs are set aside before it starts.

Steps … (terse, numbered)

<Callout type="warn">Reserving doesn't issue — material still has to be issued at the operation.</Callout>
```

### Concept (explanation)
```mdx
# Routings

A routing is the recipe the shop floor follows to make a part: the ordered operations and the work center
each runs on. It's what turns "we have an order" into "here's exactly what happens, in what order, where."

## Why it matters
Without a routing, a job can't be scheduled or costed…

## How Carbon models it
…link to the reference page for fields…

<FeatureCallout title="Try in Carbon" href="https://app.carbon.ms" cta="Open the routing builder →"
  aside="Templated per item revision.">
Lay out operations and assign work centers; Carbon estimates run time from each center's rates.
</FeatureCallout>
```

### Reference (exhaustive, scannable)
```mdx
# Work order fields

<TypeTable type={{
  quantity: { type: "number", description: "Units to produce." },
  dueDate: { type: "date", description: "Promised completion." },
  status: { type: "enum", description: "Planned · Released · In progress · Done." }
}} />
```

## Sentence-level craft

- **Openers**: state the takeaway. ✗ "This section covers routings." ✓ "A routing is the recipe the floor
  follows."
- **Transitions**: short and forward. "Now the job exists — schedule it."
- **Lists**: parallel grammar; each item a full, useful thought. Don't pad to reach a round number.
- **Numbers**: numerals for quantities ("3 operations"), tabular alignment in tables.
- **Links**: link the *noun*, inline. "Assign each operation to a **[work center](/erp/work-centers)**."
  Never "click [here]".
- **Headings**: descriptive, not cute. A reader scanning only the headings should understand the page's
  arc.

## The "earn its place" test

Before you ship a page, read it as a newcomer and check each paragraph does at least one of:
- **teaches** something they didn't know,
- **warns** them about a mistake, or
- **moves** them to the next step.

Cut anything that does none of the three. Then check the page as a whole:
- Does the first paragraph state what matters?
- Is the common mistake named?
- Is there a clear next step at the end?
- Could a real example replace any abstract sentence? If so, replace it.

If a page passes that, it's cofounder-grade. That's the bar.

## Tone calibration for Carbon

cofounder writes to startup founders; Carbon writes to manufacturers, shop managers, and the engineers
configuring their system. Keep the opinionated, specific, time-respecting voice — but the expertise is
operational, not startup-y. Sound like a sharp manufacturing systems consultant who has set up a hundred
shops and knows exactly where they go wrong: confident, concrete, never condescending, never padded.
