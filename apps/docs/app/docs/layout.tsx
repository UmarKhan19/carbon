import type { ReactNode } from "react";
import { DocsNav, type DocsNavNode } from "@/components/api/docs-nav";
import { TableOfContents } from "@/components/api/toc";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { ScrollHints } from "@/components/scroll-hints";
import { source } from "@/lib/source";
import "../reference.css";

type TreeNode = {
  type: "page" | "folder" | "separator";
  name?: unknown;
  url?: string;
  index?: { url?: string };
  children?: TreeNode[];
};

const label = (name: unknown) =>
  typeof name === "string" ? name : String(name ?? "");

const byLabel = (a: DocsNavNode, b: DocsNavNode) =>
  a.label.localeCompare(b.label);

/** Convert the Fumadocs page tree into our serializable nav shape, with the pages in
 *  each group sorted alphabetically. */
function toNav(nodes: TreeNode[]): DocsNavNode[] {
  return nodes.flatMap((n) => {
    if (n.type === "separator") return [];
    if (n.type === "folder") {
      return [
        {
          label: label(n.name),
          url: n.index?.url,
          children: toNav(n.children ?? []).sort(byLabel)
        }
      ];
    }
    return [{ label: label(n.name), url: n.url }];
  });
}

export default function ReferenceLayout({ children }: { children: ReactNode }) {
  const tree = toNav((source.getPageTree().children as TreeNode[]) ?? []);

  return (
    <div className="min-h-screen w-full bg-[#FBFBF9]">
      <MainHeader active="reference" />

      <div className="mx-auto flex w-full max-w-[1480px] pt-[64px]">
        <aside className="nav-scroll-fade sticky top-[64px] hidden h-[calc(100dvh-64px)] w-[280px] shrink-0 overflow-y-auto border-r border-[#E7E7E3] px-[20px] py-[28px] scrollbar-hidden-until-scroll lg:block">
          <DocsNav tree={tree} />
          <NavScrollChevron />
        </aside>
        <main className="min-w-0 flex-1 px-[24px] pb-[140px] pt-[40px] lg:px-[56px]">
          {children}
        </main>
        <aside className="hidden w-[232px] shrink-0 px-[28px] pt-[40px] xl:block">
          <TableOfContents />
        </aside>
      </div>

      <ScrollHints />
    </div>
  );
}
