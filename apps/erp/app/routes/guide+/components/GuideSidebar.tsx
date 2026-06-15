import { cn } from "@carbon/react";
import type React from "react";
import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { useScrollSpy } from "~/components/Docs/useScrollSpy";
import { CHAPTERS, chapterTOC, getChapter } from "../guide-content";

// The persistent left rail: a list of every chapter, plus an "On this page"
// table of contents for the chapter you're currently reading (scroll-spied).
export function GuideSidebar() {
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\/guide\/?/, "").split("/")[0];
  const current = slug ? getChapter(slug) : undefined;

  const sections = useMemo(
    () => (current ? chapterTOC(current) : []),
    [current]
  );
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  const active = useScrollSpy(ids);

  const goToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <aside className="hidden min-[880px]:block sticky top-[84px] self-start text-[0.85rem] max-h-[calc(100vh-104px)] overflow-y-auto pb-10">
      <div className="font-[var(--mono)] text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground mb-[13px]">
        Chapters
      </div>
      <nav className="flex flex-col mb-7">
        <Link
          to="/guide"
          className={cn(
            "block py-[5px] text-muted-foreground hover:text-foreground transition-colors duration-150",
            pathname === "/guide" && "text-foreground font-semibold"
          )}
        >
          Overview
        </Link>
        {CHAPTERS.map((c) => {
          const isCurrent = c.slug === slug;
          return (
            <Link
              key={c.slug}
              to={`/guide/${c.slug}`}
              className={cn(
                "block py-[5px] text-muted-foreground hover:text-foreground transition-colors duration-150",
                isCurrent && "text-foreground font-semibold"
              )}
            >
              {c.title}
            </Link>
          );
        })}
      </nav>

      {sections.length > 0 && (
        <>
          <div className="font-[var(--mono)] text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground mb-[13px]">
            On this page
          </div>
          <div className="toc-track">
            {sections.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => goToSection(e, s.id)}
                className={cn(
                  "block py-[6px] text-muted-foreground hover:text-foreground transition-colors duration-150",
                  i === active && "active text-foreground font-semibold",
                  i < active && "passed"
                )}
              >
                {s.label}
              </a>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
