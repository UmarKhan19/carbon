import { Button } from "@carbon/react";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { CHAPTERS } from "./guide-content";

export const meta: MetaFunction = () => [
  { title: "Carbon Guide — Learn Carbon end to end" },
  {
    name: "description",
    content:
      "The written manual for Carbon: core concepts, every module, and complete end-to-end workflows."
  }
];

const START_CARDS = [
  {
    slug: "core-concepts",
    title: "Core concepts",
    body: "The handful of ideas everything else builds on. Start here if Carbon is new to you."
  },
  {
    slug: "getting-started",
    title: "Getting started",
    body: "Stand up a working company: team, locations, defaults, and your first part."
  },
  {
    slug: "workflows",
    title: "End-to-end workflows",
    body: "Follow a quote, a part, or a purchase all the way through the system."
  }
];

export default function GuideIndex() {
  return (
    <main>
      <div className="pb-[10px] mb-12 reveal">
        <h1 className="font-medium tracking-[-0.045em] text-[clamp(2.6rem,5vw,3.9rem)] leading-[1.0] m-0 mb-4 [text-wrap:balance]">
          The Carbon Guide
        </h1>
        <p className="text-muted-foreground max-w-[60ch] m-0 mb-[20px] text-[1.0625rem] [text-wrap:pretty]">
          A written, self-serve manual for running your manufacturing business
          in Carbon — the same ground the Academy covers, in a form you can
          skim, search, and link to. Read it start to finish, or jump to the
          module you're working in.
        </p>
        <div className="flex gap-[10px] flex-wrap">
          <Button asChild variant="primary" size="lg">
            <Link to="/guide/core-concepts">Start with the concepts</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/guide/getting-started">Set up your company</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] mb-14">
        {START_CARDS.map((c) => (
          <Link
            key={c.slug}
            to={`/guide/${c.slug}`}
            className="group bg-card border border-border rounded-[12px] p-[18px] transition-[border-color,transform] duration-200 hover:border-[var(--acc)] active:scale-[0.99]"
          >
            <div className="font-semibold text-[0.98rem] mb-[6px] group-hover:text-[var(--acc)] transition-colors">
              {c.title}
            </div>
            <p className="text-muted-foreground text-[0.85rem] m-0 leading-[1.55]">
              {c.body}
            </p>
          </Link>
        ))}
      </div>

      <div className="font-[var(--mono)] text-[0.68rem] tracking-[0.18em] uppercase text-muted-foreground mb-5">
        Every chapter
      </div>
      <div className="border-t border-border">
        {CHAPTERS.map((c) => (
          <Link
            key={c.slug}
            to={`/guide/${c.slug}`}
            className="group grid grid-cols-[180px_1fr] gap-[28px] items-baseline py-[16px] border-b border-border transition-colors hover:bg-card/60 -mx-[10px] px-[10px] rounded-[6px]"
          >
            <div className="font-semibold text-[0.95rem] group-hover:text-[var(--acc)] transition-colors">
              {c.title}
            </div>
            <p className="text-muted-foreground text-[0.88rem] m-0 [text-wrap:pretty]">
              {c.summary}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
