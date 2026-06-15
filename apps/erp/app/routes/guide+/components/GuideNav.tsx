import { Button } from "@carbon/react";
import { ThemeToggle } from "~/components/Docs/ThemeToggle";

export function GuideNav() {
  return (
    // z-40 keeps the nav above page content but below the z-50 screenshot lightbox.
    <header className="sticky top-0 z-40 h-[68px] flex items-center bg-[var(--canvas-blur)] backdrop-blur-[12px] saturate-[160%] border-b border-border">
      <div className="container flex items-center gap-[26px] w-full">
        <a
          className="flex items-center gap-[9px] font-semibold text-base tracking-[-0.02em]"
          href="/guide"
        >
          <img
            className="h-[23px] w-auto block dark:hidden"
            src="/carbon-word-light.svg"
            alt="Carbon"
          />
          <img
            className="h-[23px] w-auto hidden dark:block"
            src="/carbon-word-dark.svg"
            alt="Carbon"
          />
          <span className="font-[var(--mono)] text-[0.7rem] tracking-[0.12em] uppercase text-muted-foreground border-l border-border pl-[10px] ml-[2px]">
            Guide
          </span>
        </a>
        <div className="ml-auto flex items-center gap-[10px]">
          <ThemeToggle />
          <Button asChild variant="primary" size="md">
            <a href="/x">Open Carbon</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
