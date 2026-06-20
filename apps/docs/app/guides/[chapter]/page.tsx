import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { GuideChapter } from "@/components/editorial/guide-context";
import { GuideProvider } from "@/components/editorial/guide-context";
import { GuideSubnav } from "@/components/editorial/guide-subnav";
import { HowToLayout } from "@/components/editorial/how-to-layout";
import { editorialMdxComponents } from "@/components/editorial/mdx";
import { MainHeader } from "@/components/main-header";
import { guideSource } from "@/lib/source";

type Params = { params: Promise<{ chapter: string }> };

// Fumadocs' toc item `title` is a ReactNode (often a React element, not a string),
// so pull the plain text out of it — otherwise the rail renders "[object Object]".
function tocText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(tocText).join("");
  if (typeof node === "object" && "props" in node) {
    return tocText(
      (node as { props?: { children?: ReactNode } }).props?.children
    );
  }
  return "";
}

// Chapters in reading order: flows are ordered by `flowIndex`, chapters within a
// flow by `index`. This keeps each flow's chapters contiguous in the flat list.
function orderedPages() {
  return guideSource
    .getPages()
    .slice()
    .sort(
      (a, b) =>
        (a.data.flowIndex ?? 0) - (b.data.flowIndex ?? 0) ||
        (a.data.index ?? 0) - (b.data.index ?? 0)
    );
}

export function generateStaticParams() {
  return orderedPages().map((p) => ({ chapter: p.slugs[0] }));
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { chapter } = await props.params;
  const page = orderedPages().find((p) => p.slugs[0] === chapter);
  return {
    title: page ? `${page.data.title} — Carbon` : "Carbon Docs",
    description: page?.data.description
  };
}

export default async function GuidePage(props: Params) {
  const { chapter } = await props.params;
  const pages = orderedPages();
  if (!pages.some((p) => p.slugs[0] === chapter)) notFound();

  // Serializable chapter nav: slug/title/label + the section items (one per `##`
  // heading) pulled from each file's table of contents, anchored on its rehype id.
  const chapters: GuideChapter[] = pages.map((p) => ({
    slug: p.slugs[0],
    index: p.data.index,
    title: p.data.title,
    description: p.data.description,
    label: p.data.label,
    flow: p.data.flow,
    flowName: p.data.flowName,
    flowIndex: p.data.flowIndex,
    items: p.data.toc
      .filter((t) => t.depth === 2)
      .map((t) => ({
        title: tocText(t.title),
        id: t.url.replace(/^#/, "")
      }))
  }));

  // Render each chapter's MDX body once on the server; the client reader shows the
  // active one and cross-fades on switch — no route navigation, no remount flash.
  const bodies = pages.map((p) => {
    const MDX = p.data.body;
    return <MDX key={p.slugs[0]} components={editorialMdxComponents} />;
  });

  return (
    <GuideProvider chapters={chapters} initialSlug={chapter}>
      <MainHeader active="guides" />
      <GuideSubnav />
      <HowToLayout bodies={bodies} />
    </GuideProvider>
  );
}
