import type { ReactNode } from "react";

// A deliberately tiny inline formatter for guide prose. Supports `**bold**`,
// `*italic*`, and `` `code` `` — enough to make documentation readable without
// pulling in a full markdown dependency.
export function renderInline(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on the three supported spans, keeping the delimiters.
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = md.split(re);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code
          key={i}
          className="font-[var(--mono)] text-[0.85em] bg-muted border border-border rounded-[4px] px-[5px] py-[1px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      out.push(
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    } else {
      out.push(part);
    }
  });
  return out;
}
