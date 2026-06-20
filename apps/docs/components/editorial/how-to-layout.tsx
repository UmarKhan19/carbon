"use client";

import type { ReactNode } from "react";
import { PageFeedback } from "@/components/api/page-feedback";
import { ScrollArea } from "./custom-scrollbar";
import { chaptersInFlow, useGuide } from "./guide-context";
import { SidebarNav } from "./sidebar-nav";

function FooterChevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d={dir === "left" ? "M8.5 3.5L5 7l3.5 3.5" : "M5.5 3.5L9 7l-3.5 3.5"}
        stroke="rgba(38,35,35,0.55)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Prev/next chapter card — mirrors the ContentFooter cards, but switches chapter via goTo. */
function ChapterCard({ dir, title, onSelect }: { dir: "prev" | "next"; title: string; onSelect: () => void }) {
  const next = dir === "next";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-[10px] rounded-[12px] border border-[#E7E7E3] bg-[rgba(251,251,248,0.6)] px-[16px] py-[12px] text-left shadow-[inset_0_1px_0_#fff] transition-colors hover:border-[#D9D9D3] hover:bg-[rgba(255,255,255,0.7)] ${
        next ? "flex-row-reverse text-right" : ""
      }`}
    >
      <FooterChevron dir={next ? "right" : "left"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-[family-name:var(--font-mono)] text-[10.5px] font-[600] uppercase tracking-[0.08em] text-[rgba(38,35,35,0.5)]">
          {next ? "Next" : "Previous"}
        </span>
        <span className="truncate text-[15px] font-[560] text-ink-ui transition-colors group-hover:text-[#262323]">
          {title}
        </span>
      </span>
    </button>
  );
}

export function HowToLayout({ bodies }: { bodies: ReactNode[] }) {
  const { active, goTo, registerScrollEl, chapters } = useGuide();

  const currentChapter = chapters[active.chapter];
  if (!currentChapter) return null;

  // Chapters of the current flow (with global indices) for the mobile selector and
  // the "read next" link — navigation stays within a flow, never spilling into the next.
  const flowChapters = chaptersInFlow(chapters, currentChapter.flow);
  const posInFlow = flowChapters.findIndex((c) => c.index === active.chapter);
  const prevInFlow = flowChapters[posInFlow - 1];
  const nextInFlow = flowChapters[posInFlow + 1];

  return (
    <main
      className="bg-[#F5F5F2] overflow-hidden min-h-0"
      style={{ height: "100dvh", paddingTop: "116px" }}
    >
      <div className="mx-auto w-full max-w-[1440px] px-[20px] flex h-full min-h-0 overflow-hidden">
        {/* Sidebar (desktop) */}
        <div className="hidden min-[1000px]:flex shrink-0 w-[260px] flex-col overflow-y-auto scrollbar-hidden-until-scroll nav-scroll-fade pl-[50px] pr-[10px] pt-[40px] pb-[40px]">
          <SidebarNav chapters={chapters} active={active} onActiveChange={goTo} />
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Mobile chapter selector */}
          <div className="min-[1000px]:hidden px-[20px] pt-[20px] pb-[10px]">
            <div className="flex gap-[8px] overflow-x-auto scrollbar-none">
              {flowChapters.map(({ chapter, index }) => (
                <button
                  key={chapter.slug}
                  type="button"
                  onClick={() => goTo({ chapter: index, item: 0 })}
                  className={`shrink-0 whitespace-nowrap px-[14px] py-[8px] rounded-[8px] border-none cursor-pointer text-[14px] font-[460] tracking-[0.14px] transition-all duration-200 ${
                    active.chapter === index
                      ? "bg-[rgba(231,231,227,0.80)] text-ink-ui"
                      : "bg-transparent text-ink-faint hover:bg-[rgba(231,231,227,0.40)]"
                  }`}
                >
                  {chapter.title}
                </button>
              ))}
            </div>
          </div>

          {/* Main content with custom scrollbar */}
          <div className="flex-1 min-h-0 flex">
            <ScrollArea scrollbarOffset={20} onScrollElement={registerScrollEl}>
              <div className="px-[20px] min-[476px]:pl-[32px] min-[1000px]:pl-[130px] min-[1000px]:pr-[20px] pb-[100px]">
                <div className="max-w-[620px]">
                  <div className="pt-[44px]">
                    <span
                      className="inline-flex items-center justify-center rounded-[100px] px-[8px] py-[4px] font-[family-name:var(--font-mono)] text-[12px] font-medium leading-[16px] text-[rgba(38,35,35,0.5)] whitespace-nowrap"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(251, 251, 248, 0.50) 0%, rgba(251, 251, 248, 0.00) 100%)",
                        boxShadow:
                          "0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 2px 0 rgba(0, 0, 0, 0.02)",
                      }}
                    >
                      {currentChapter.label} — {currentChapter.slug.toUpperCase()}
                    </span>
                  </div>

                  {/* MDX body for the active chapter */}
                  {bodies[active.chapter]}

                  {/* Footer — feedback + within-flow prev/next, matching the docs pages. */}
                  <footer className="mt-[64px] border-t border-[rgba(38,35,35,0.12)] pt-[26px]">
                    <PageFeedback key={active.chapter} variant="editorial" />
                    {(prevInFlow || nextInFlow) && (
                      <nav className="mt-[22px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                        <div>
                          {prevInFlow && (
                            <ChapterCard
                              dir="prev"
                              title={prevInFlow.chapter.title}
                              onSelect={() => goTo({ chapter: prevInFlow.index, item: 0 })}
                            />
                          )}
                        </div>
                        <div>
                          {nextInFlow && (
                            <ChapterCard
                              dir="next"
                              title={nextInFlow.chapter.title}
                              onSelect={() => goTo({ chapter: nextInFlow.index, item: 0 })}
                            />
                          )}
                        </div>
                      </nav>
                    )}
                  </footer>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </main>
  );
}
