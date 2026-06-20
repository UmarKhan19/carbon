"use client";

/**
 * GuideProvider owns the editorial reader's active-chapter/section state and all
 * scroll orchestration, so BOTH the header and the sidebar switch chapters with
 * pure client state — no Next route navigation, no remount, no flash.
 *
 * Chapter content is authored in MDX; the server passes down a serializable
 * `chapters` list (slug/title/label + the section items derived from each file's
 * table of contents) plus the rendered bodies. Section anchors are the heading ids
 * Fumadocs' rehype-slug already injected, so the rail, scrollspy, and deep links all
 * key off the same id.
 *
 * Chapter changes animate via the View Transitions API; reduced-motion users get an
 * instant swap. The URL is kept in sync silently via history.replaceState.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

export type GuideItem = { title: string; id: string };

export type GuideChapter = {
  slug: string;
  index: number;
  title: string;
  description: string;
  label: string;
  flow: string;
  flowName: string;
  flowIndex: number;
  items: GuideItem[];
};

export type GuideFlow = { slug: string; name: string; firstIndex: number };

/** Distinct flows in reading order, each with the global index of its first chapter.
 *  `chapters` is already sorted by (flowIndex, index), so each flow is contiguous. */
export function flowsOf(chapters: GuideChapter[]): GuideFlow[] {
  const out: GuideFlow[] = [];
  chapters.forEach((c, i) => {
    if (!out.some((f) => f.slug === c.flow)) out.push({ slug: c.flow, name: c.flowName, firstIndex: i });
  });
  return out;
}

/** The chapters belonging to one flow, each paired with its global index. */
export function chaptersInFlow(
  chapters: GuideChapter[],
  flow: string,
): { chapter: GuideChapter; index: number }[] {
  return chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter((x) => x.chapter.flow === flow);
}

type Pos = { chapter: number; item: number };

type GuideCtx = {
  active: Pos;
  goTo: (pos: Pos) => void;
  registerScrollEl: (el: HTMLDivElement | null) => void;
  chapters: GuideChapter[];
};

const Ctx = createContext<GuideCtx | null>(null);

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => unknown };

export function GuideProvider({
  chapters,
  initialSlug,
  children,
}: {
  chapters: GuideChapter[];
  initialSlug: string;
  children: ReactNode;
}) {
  const initialChapter = Math.max(
    0,
    chapters.findIndex((c) => c.slug === initialSlug),
  );
  const [active, setActive] = useState<Pos>({ chapter: initialChapter, item: 0 });

  const activeRef = useRef(active);
  activeRef.current = active;

  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolling = useRef(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollElRef.current = el;
  }, []);

  const scrollToAnchor = useCallback((id: string, smooth: boolean) => {
    const el = scrollElRef.current;
    if (!el || !id) return;
    const target = el.querySelector(`#${CSS.escape(id)}`);
    if (!(target instanceof HTMLElement)) return;
    const top =
      target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 32;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  const goTo = useCallback(
    (pos: Pos) => {
      const chapter = chapters[pos.chapter];
      if (!chapter) return;

      const prev = activeRef.current;
      const isNewChapter = pos.chapter !== prev.chapter;
      const anchor = chapter.items[pos.item]?.id ?? "";

      // Suppress the scrollspy while we drive the scroll programmatically.
      isUserScrolling.current = true;
      if (guardTimer.current) clearTimeout(guardTimer.current);
      guardTimer.current = setTimeout(() => {
        isUserScrolling.current = false;
      }, 700);

      if (!isNewChapter) {
        // Same chapter — just glide to the section, no transition.
        setActive(pos);
        requestAnimationFrame(() => scrollToAnchor(anchor, true));
        return;
      }

      // New chapter — swap content + jump to its top inside a view transition.
      const apply = () => {
        flushSync(() => setActive(pos));
        scrollToAnchor(anchor, false);
      };

      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const doc = document as DocWithVT;

      if (!reduce && typeof doc.startViewTransition === "function") {
        doc.startViewTransition(apply);
      } else {
        apply();
      }

      window.history.replaceState(null, "", `/guides/${chapter.slug}`);
    },
    [chapters, scrollToAnchor],
  );

  // Scrollspy: update the active section as the reader scrolls.
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isUserScrolling.current) return;
      const rect = el.getBoundingClientRect();
      const threshold = rect.top + rect.height * 0.4;
      const chapter = chapters[activeRef.current.chapter];
      if (!chapter) return;

      let closestItem = 0;
      for (let i = 0; i < chapter.items.length; i++) {
        const heading = el.querySelector(`#${CSS.escape(chapter.items[i].id)}`);
        if (heading instanceof HTMLElement && heading.getBoundingClientRect().top <= threshold) {
          closestItem = i;
        }
      }
      setActive((p) => (p.item === closestItem ? p : { ...p, item: closestItem }));
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [chapters, active.chapter]);

  return (
    <Ctx.Provider value={{ active, goTo, registerScrollEl, chapters }}>{children}</Ctx.Provider>
  );
}

export function useGuide() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGuide must be used within a GuideProvider");
  return ctx;
}
