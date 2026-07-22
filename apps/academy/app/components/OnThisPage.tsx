import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

type TocLesson = { id: string; text: string };
type TocTopic = { id: string; text: string; lessons: TocLesson[] };

/** "On this page" rail — an outline of the article's `section[id]` topics and,
 *  nested under each, its lesson rows (`[data-toc-lesson]`). Scrollspies the
 *  active anchor. Renders nothing when the page has no such sections, so it
 *  self-hides on pages without a topic list. */
export function OnThisPage() {
  const { pathname } = useLocation();
  const [topics, setTopics] = useState<TocTopic[]>([]);
  const [active, setActive] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the active entry visible inside the TOC's own scroll area (like docs) —
  // scrolls only the nav container, never the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when active changes
  useEffect(() => {
    const el = activeRef.current;
    const scroller = navRef.current;
    if (!el || !scroller) return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const PAD = 24;
    if (er.top < sr.top + PAD) {
      scroller.scrollTo({
        top: scroller.scrollTop - (sr.top + PAD - er.top),
        behavior: "smooth"
      });
    } else if (er.bottom > sr.bottom - PAD) {
      scroller.scrollTo({
        top: scroller.scrollTop + (er.bottom - sr.bottom + PAD),
        behavior: "smooth"
      });
    }
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan on route change
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("main section[id]")
    );
    const items: TocTopic[] = sections
      .map((section) => ({
        id: section.id,
        text: section.querySelector("h2, h3")?.textContent ?? "",
        lessons: Array.from(
          section.querySelectorAll<HTMLElement>("[data-toc-lesson]")
        )
          .filter((el) => el.id)
          .map((el) => ({ id: el.id, text: el.dataset.tocTitle ?? "" }))
      }))
      .filter((t) => t.text.trim());
    setTopics(items);

    // Observe every topic + lesson anchor, in document order, for scrollspy.
    const nodes = sections.flatMap((section) => [
      section,
      ...Array.from(section.querySelectorAll<HTMLElement>("[data-toc-lesson]"))
    ]);
    if (nodes.length === 0) return;

    // Active = the deepest anchor whose top has scrolled above the fold line.
    // Iterating in document order means a lesson wins over its parent section
    // (both are "above the line", the lesson is last).
    const recompute = () => {
      const line = 120;
      let current = nodes[0]?.id ?? "";
      for (const n of nodes) {
        if (n.getBoundingClientRect().top <= line) current = n.id;
        else break;
      }
      setActive(current);
    };
    recompute();

    const observer = new IntersectionObserver(recompute, {
      rootMargin: "-110px 0px -60% 0px",
      threshold: [0, 1]
    });
    for (const n of nodes) observer.observe(n);
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", recompute);
    };
  }, [pathname]);

  // Explicit scroll on click — a bare `#hash` anchor gets swallowed by the SPA's
  // scroll restoration, so drive it ourselves. scrollIntoView honors the target's
  // scroll-margin (the fixed-header offset); the hash update lights the :target row.
  const go = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    setActive(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    window.history.replaceState(null, "", `#${id}`);
  };

  if (topics.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="sticky top-24 max-h-[calc(100dvh-120px)] overflow-y-auto pr-2 scrollbar-hidden-until-scroll"
    >
      <p className="mb-3 font-mono text-ed-11 font-semibold uppercase tracking-[0.1em] text-ed-ink/45">
        On this page
      </p>
      <ul className="m-0 flex list-none flex-col border-l border-ed-hairline p-0">
        {topics.flatMap((topic) => {
          const topicInFocus =
            active === topic.id || topic.lessons.some((l) => l.id === active);
          return [
            <li key={topic.id} className="-ml-px">
              <a
                ref={active === topic.id ? activeRef : undefined}
                href={`#${topic.id}`}
                onClick={go(topic.id)}
                aria-current={active === topic.id ? "location" : undefined}
                className={`block border-l-2 py-1.5 pl-4 text-ed-13 leading-snug no-underline transition-colors duration-150 ${
                  active === topic.id
                    ? "border-ed-brand-ink font-demi text-ed-brand-ink"
                    : topicInFocus
                      ? "border-transparent font-demi text-ed-ink"
                      : "border-transparent font-demi text-ed-ink/60 hover:text-ed-ink"
                }`}
              >
                {topic.text}
              </a>
            </li>,
            ...topic.lessons.map((lesson) => {
              const isActive = active === lesson.id;
              return (
                <li key={lesson.id} className="-ml-px">
                  <a
                    ref={isActive ? activeRef : undefined}
                    href={`#${lesson.id}`}
                    onClick={go(lesson.id)}
                    aria-current={isActive ? "location" : undefined}
                    className={`block border-l-2 py-1 pl-7 text-ed-12 leading-snug no-underline transition-colors duration-150 ${
                      isActive
                        ? "border-ed-brand-ink font-book text-ed-brand-ink"
                        : "border-transparent font-book text-ed-ink/50 hover:text-ed-ink/80"
                    }`}
                  >
                    {lesson.text}
                  </a>
                </li>
              );
            })
          ];
        })}
      </ul>
    </nav>
  );
}
