"use client";

/* Click-to-enlarge for guide figures and screenshots. The thumbnail and the
 * fullscreen overlay share a Framer Motion `layoutId`, so opening morphs the image
 * up into a centered lightbox and closing morphs it back — no cut, no reload. Esc or
 * a backdrop click closes it; body scroll is locked while open. */

import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

const spring = { type: "spring", stiffness: 280, damping: 32 } as const;

export function Zoomable({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const id = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <motion.button
        type="button"
        layoutId={id}
        transition={spring}
        onClick={() => setOpen(true)}
        aria-label="Enlarge"
        style={{ opacity: open ? 0 : 1 }}
        className="group relative block w-full cursor-zoom-in appearance-none border-0 bg-transparent p-0 text-left"
      >
        {children}
        <span className="pointer-events-none absolute right-[14px] top-[14px] flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-[#E7E7E3] bg-[#FBFBF8]/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
              stroke="rgba(38,35,35,0.55)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </motion.button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="zoom-overlay"
                className="fixed inset-0 z-[300] flex items-center justify-center p-[20px] md:p-[56px]"
                onClick={() => setOpen(false)}
              >
                <motion.div
                  aria-hidden
                  className="absolute inset-0 bg-[rgba(38,35,35,0.55)] backdrop-blur-[3px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
                <motion.div
                  layoutId={id}
                  transition={spring}
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-10 w-full max-w-[min(1100px,92vw)] max-h-[88vh] cursor-zoom-out overflow-auto"
                >
                  {children}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
