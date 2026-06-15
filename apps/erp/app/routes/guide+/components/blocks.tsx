import { Screenshot } from "~/components/Docs/Screenshot";
import { SpecList, SpecRow } from "~/components/Docs/SpecRow";
import type { GuideBlock } from "../guide-content";
import { renderInline } from "./inline";

function Prose({ md }: { md: string }) {
  return (
    <p className="text-muted-foreground text-[0.95rem] leading-[1.7] max-w-[68ch] m-0 [text-wrap:pretty]">
      {renderInline(md)}
    </p>
  );
}

const CALLOUT_TONES: Record<
  "note" | "tip" | "warning",
  { ring: string; label: string; defaultTitle: string }
> = {
  note: {
    ring: "border-border",
    label: "text-muted-foreground",
    defaultTitle: "Note"
  },
  tip: {
    ring: "border-[var(--acc-ring)]",
    label: "text-[var(--acc)]",
    defaultTitle: "Tip"
  },
  warning: {
    ring: "border-amber-500/40",
    label: "text-amber-600 dark:text-amber-500",
    defaultTitle: "Heads up"
  }
};

function Callout({
  tone,
  title,
  md
}: {
  tone: "note" | "tip" | "warning";
  title?: string;
  md: string;
}) {
  const t = CALLOUT_TONES[tone];
  return (
    <div
      className={`bg-card border ${t.ring} rounded-[10px] px-[16px] py-[13px] max-w-[68ch]`}
    >
      <div
        className={`font-[var(--mono)] text-[0.65rem] tracking-[0.14em] uppercase font-semibold mb-[6px] ${t.label}`}
      >
        {title ?? t.defaultTitle}
      </div>
      <p className="text-muted-foreground text-[0.88rem] leading-[1.6] m-0 [text-wrap:pretty]">
        {renderInline(md)}
      </p>
    </div>
  );
}

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="stagger list-none m-0 p-0 max-w-[68ch] flex flex-col gap-[10px]">
      {items.map((item, i) => (
        <li key={i} className="flex gap-[13px] items-start">
          <span className="shrink-0 mt-[1px] w-[24px] h-[24px] inline-flex items-center justify-center rounded-full bg-[var(--acc-tint-strong)] border border-[var(--acc-ring)] text-[var(--acc)] font-[var(--mono)] text-[0.72rem] font-semibold">
            {i + 1}
          </span>
          <span className="text-muted-foreground text-[0.92rem] leading-[1.6] pt-[2px] [text-wrap:pretty]">
            {renderInline(item)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// Renders a real lightbox once a screenshot is captured; until then a labelled
// placeholder keeps the page complete and reviewable.
function ScreenshotSlot({
  src,
  alt,
  caption
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="m-0 max-w-[760px]">
      {src ? (
        <Screenshot src={src} alt={alt} />
      ) : (
        <div className="w-full aspect-[16/9] rounded-[9px] border border-dashed border-border bg-muted/40 flex flex-col items-center justify-center text-center px-6 gap-[6px]">
          <span className="font-[var(--mono)] text-[0.62rem] tracking-[0.16em] uppercase text-muted-foreground">
            Screenshot
          </span>
          <span className="text-muted-foreground text-[0.85rem] max-w-[40ch]">
            {alt}
          </span>
        </div>
      )}
      {caption && (
        <figcaption className="text-muted-foreground text-[0.78rem] mt-[8px] [text-wrap:pretty]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "prose":
      return <Prose md={block.md} />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} md={block.md} />;
    case "steps":
      return <StepList items={block.items} />;
    case "spec":
      return (
        <SpecList>
          {block.rows.map((r) => (
            <SpecRow key={r.label} label={r.label}>
              {r.value}
            </SpecRow>
          ))}
        </SpecList>
      );
    case "screenshot":
      return (
        <ScreenshotSlot
          src={block.src}
          alt={block.alt}
          caption={block.caption}
        />
      );
  }
}
