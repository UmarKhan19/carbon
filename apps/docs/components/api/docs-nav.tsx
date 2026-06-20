"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type DocsNavNode = { label: string; url?: string; children?: DocsNavNode[] };

const GS_ACTIVE = "bg-[rgba(0,176,255,0.10)] font-[530] text-[#1E84B0]";
const GS_IDLE = "text-[rgba(38,35,35,0.8)] hover:bg-[rgba(231,231,227,0.55)] hover:text-[#262323]";
const GS_LINK = "block rounded-[6px] px-[8px] py-[4px] text-[14.5px] leading-[135%] transition-colors";
const SECTION_LABEL =
  "font-[family-name:var(--font-mono)] text-[12.5px] font-[600] uppercase tracking-[0.06em] text-[rgba(38,35,35,0.6)]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M4.5 3L7.5 6L4.5 9" stroke="rgba(38,35,35,0.48)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocsNav({ tree }: { tree: DocsNavNode[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const isActive = (url?: string) => !!url && pathname === url;

  return (
    <nav className="flex flex-col gap-[2px]">
      {tree.map((node) => {
        if (!node.children?.length) {
          return (
            <Link
              key={node.label}
              href={node.url ?? "#"}
              className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
            >
              {node.label}
            </Link>
          );
        }

        const isOpen = !collapsed.has(node.label);
        return (
          <div key={node.label} className="mt-[8px] first:mt-[2px]">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.label)) next.delete(node.label);
                  else next.add(node.label);
                  return next;
                })
              }
              className="flex w-full items-center gap-[7px] rounded-[7px] px-[8px] py-[5px] transition-colors hover:bg-[rgba(231,231,227,0.5)]"
            >
              <Chevron open={isOpen} />
              <span className={SECTION_LABEL}>{node.label}</span>
            </button>

            {isOpen && (
              <ul className="mt-[2px] mb-[2px] ml-[13px] list-none border-l border-[#ECECE7] py-[2px] pl-[8px]">
                {node.url && (
                  <li>
                    <Link
                      href={node.url}
                      className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
                    >
                      Overview
                    </Link>
                  </li>
                )}
                {node.children.map((child) => (
                  <li key={child.label}>
                    <Link
                      href={child.url ?? "#"}
                      className={`${GS_LINK} ${isActive(child.url) ? GS_ACTIVE : GS_IDLE}`}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
