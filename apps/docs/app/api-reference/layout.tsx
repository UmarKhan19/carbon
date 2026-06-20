import type { ReactNode } from "react";
import { ApiNav } from "@/components/api/api-nav";
import { ApiConfigProvider } from "@/components/api/config-context";
import { Configurator } from "@/components/api/configurator";
import { MainHeader } from "@/components/main-header";
import { ReadingProgress } from "@/components/reading-progress";
import { navTree } from "@/lib/api-data";

export default function ApiReferenceLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-[#FBFBF9]">
      <MainHeader active="api" mobileNav={<ApiNav tree={navTree} />} />

      <ApiConfigProvider>
        <div className="mx-auto flex w-full max-w-[1480px] pt-[64px]">
          <aside className="sticky top-[64px] hidden h-[calc(100dvh-64px)] w-[280px] shrink-0 overflow-y-auto border-r border-[#E7E7E3] px-[20px] py-[28px] scrollbar-hidden-until-scroll nav-scroll-fade lg:block">
            <Configurator />
            <ApiNav tree={navTree} />
          </aside>
          <main className="min-w-0 flex-1 px-[24px] pb-[140px] pt-[40px] lg:px-[56px]">
            {children}
          </main>
          <aside className="hidden w-[72px] shrink-0 justify-end pl-[16px] xl:flex">
            <ReadingProgress top={88} />
          </aside>
        </div>
      </ApiConfigProvider>
    </div>
  );
}
