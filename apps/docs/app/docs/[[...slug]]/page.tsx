import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsFooter } from "@/components/api/page-footer";
import { getMDXComponents } from "@/components/mdx";
import { source } from "@/lib/source";

type Params = { params: Promise<{ slug?: string[] }> };

export default async function Page(props: Params) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="max-w-[760px]">
      <h1 className="reference-title m-0">{page.data.title}</h1>
      {page.data.description && (
        <p className="reference-desc m-0 mt-[12px]">{page.data.description}</p>
      )}
      <div className="prose mt-[30px]">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page)
          })}
        />
      </div>
      <DocsFooter url={page.url} />
    </article>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description
  };
}
