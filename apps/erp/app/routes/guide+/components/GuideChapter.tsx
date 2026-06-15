import { Section } from "~/components/Docs/Section";
import type { Chapter } from "../guide-content";
import { Block } from "./blocks";

// Renders a whole chapter from its data: a lede, then each section with its
// blocks. Every chapter route file delegates to this.
export function GuideChapter({ chapter }: { chapter: Chapter }) {
  return (
    <main>
      <div className="pb-[10px] mb-6 reveal">
        <div className="font-[var(--mono)] text-[0.68rem] tracking-[0.18em] uppercase text-muted-foreground mb-3">
          {chapter.eyebrow}
        </div>
        <h1 className="font-medium tracking-[-0.04em] text-[clamp(2rem,4vw,3rem)] leading-[1.02] m-0 mb-[14px] [text-wrap:balance]">
          {chapter.title}
        </h1>
        <p className="text-muted-foreground max-w-[62ch] m-0 text-[1.0625rem] [text-wrap:pretty]">
          {chapter.summary}
        </p>
      </div>
      {chapter.sections.map((section) => (
        <Section
          key={section.id}
          id={section.id}
          fig={section.fig}
          label={section.label}
          title={section.title}
        >
          <div className="flex flex-col gap-[18px] mt-[14px]">
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </div>
        </Section>
      ))}
    </main>
  );
}
