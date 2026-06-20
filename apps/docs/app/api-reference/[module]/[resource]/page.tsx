import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BaseUrl } from "@/components/api/base-url";
import { EndpointSection } from "@/components/api/endpoint-section";
import { allResourceParams, apiBase, getResource } from "@/lib/api-data";

type Params = { params: Promise<{ module: string; resource: string }> };

export function generateStaticParams() {
  return allResourceParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { module, resource } = await props.params;
  const found = getResource(module, resource);
  return {
    title: found ? `${found.resource.name} — Carbon API` : "Carbon API",
    description: found?.resource.description
  };
}

export default async function ResourcePage(props: Params) {
  const { module, resource } = await props.params;
  const found = getResource(module, resource);
  if (!found) notFound();
  const { module: mod, resource: r } = found;

  return (
    <div className="max-w-[1180px]">
      <p className="m-0 font-[family-name:var(--font-mono)] text-[12px] font-medium uppercase tracking-[0.08em] text-[rgba(38,35,35,0.5)]">
        {mod.name}
      </p>
      <h1 className="m-0 mt-[8px] text-[34px] font-[560] leading-[120%] text-[#262323]">
        {r.name}
      </h1>
      <p className="m-0 mt-[12px] max-w-[640px] text-[16.5px] leading-[160%] text-[rgba(38,35,35,0.8)]">
        {r.description}
      </p>
      <BaseUrl path={r.endpoints[0]?.path ?? ""} />

      {r.endpoints.map((e) => (
        <EndpointSection key={e.id} endpoint={e} base={apiBase} />
      ))}
    </div>
  );
}
