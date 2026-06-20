"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const TRACK_COLOR = [208, 209, 210];
const ACTIVE_COLOR = [0, 176, 255];

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  scrollbarOffset?: number;
  onScrollElement?: (el: HTMLDivElement | null) => void;
}

export function ScrollArea({
  children,
  className = "",
  scrollbarOffset = 20,
  onScrollElement,
}: ScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbPos, setThumbPos] = useState(0);
  const [dotCount, setDotCount] = useState(0);
  const [hoverDot, setHoverDot] = useState<number | null>(null);

  useLayoutEffect(() => {
    onScrollElement?.(scrollRef.current);
    return () => onScrollElement?.(null);
  }, [onScrollElement]);

  const recalc = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const dots = Math.floor(track.clientHeight / 7);
    setDotCount(dots);

    if (scrollHeight <= clientHeight) {
      setThumbPos(0);
    } else {
      setThumbPos(Math.round((scrollTop / (scrollHeight - clientHeight)) * (dots - 1)));
    }
  }, []);

  const scrollTo = useCallback((y: number) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    el.scrollTop = pct * max;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      scrollTo(e.clientY);

      const onMove = (ev: PointerEvent) => scrollTo(ev.clientY);
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [scrollTo],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    recalc();
    el.addEventListener("scroll", recalc, { passive: true });
    const observer = new ResizeObserver(recalc);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", recalc);
      observer.disconnect();
    };
  }, [recalc]);

  const getDotIndex = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track || dotCount <= 0) return null;
      const rect = track.getBoundingClientRect();
      return Math.round(
        Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * (dotCount - 1),
      );
    },
    [dotCount],
  );

  return (
    <div className="flex-1 min-w-0 flex min-h-0 my-8">
      <div
        ref={scrollRef}
        className={`flex-1 min-w-0 min-h-0 overflow-y-auto scrollbar-none ${className}`}
        style={{ paddingRight: `${scrollbarOffset}px` }}
      >
        {children}
      </div>

      {/* Custom magnetic tick scrollbar */}
      <div className="shrink-0 hidden min-[1000px]:block">
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={(e) => setHoverDot(getDotIndex(e.clientY))}
          onPointerLeave={() => setHoverDot(null)}
          className="h-[80vh] flex flex-col items-end cursor-pointer touch-none"
          style={{ gap: "5px", width: 14 }}
        >
          {Array.from({ length: dotCount }).map((_, i) => {
            const dist = Math.abs(i - thumbPos) / 3;
            const isNear = dist <= 1;
            const influence = isNear ? Math.cos((dist * Math.PI) / 2) ** 2 : 0;
            const isHovered = hoverDot === i;

            const lerp = (a: number, b: number) => Math.round(a + (b - a) * influence);

            const color = isHovered
              ? `rgb(${ACTIVE_COLOR[0]}, ${ACTIVE_COLOR[1]}, ${ACTIVE_COLOR[2]})`
              : isNear
                ? `rgb(${lerp(TRACK_COLOR[0], ACTIVE_COLOR[0])}, ${lerp(TRACK_COLOR[1], ACTIVE_COLOR[1])}, ${lerp(TRACK_COLOR[2], ACTIVE_COLOR[2])})`
                : "rgba(32, 32, 32, 0.16)";

            return (
              <span
                key={i}
                className="shrink-0 rounded-full"
                style={{
                  width: isHovered ? 14 : isNear ? 7 + 7 * influence : 7,
                  height: 2,
                  background: color,
                  transition:
                    "background 120ms linear, width 120ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
